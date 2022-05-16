// [assignment] please copy the entire modified custom.test.js here
const hre = require("hardhat");
const { ethers, waffle } = hre;
const { loadFixture } = waffle;
const { expect } = require("chai");
const { utils } = ethers;

const Utxo = require("../src/utxo");
const {
  transaction,
  registerAndTransact,
  prepareTransaction,
  buildMerkleTree,
} = require("../src/index");
const { toFixedHex, poseidonHash } = require("../src/utils");
const { Keypair } = require("../src/keypair");
const { encodeDataForBridge } = require("./utils");

const MERKLE_TREE_HEIGHT = 5;
const l1ChainId = 1;
const MINIMUM_WITHDRAWAL_AMOUNT = utils.parseEther(
  process.env.MINIMUM_WITHDRAWAL_AMOUNT || "0.05"
);
const MAXIMUM_DEPOSIT_AMOUNT = utils.parseEther(
  process.env.MAXIMUM_DEPOSIT_AMOUNT || "1"
);

describe("Custom Tests", function () {
  this.timeout(20000);

  async function deploy(contractName, ...args) {
    const Factory = await ethers.getContractFactory(contractName);
    const instance = await Factory.deploy(...args);
    return instance.deployed();
  }

  async function fixture() {
    require("../scripts/compileHasher");
    const [sender, gov, l1Unwrapper, multisig] = await ethers.getSigners();
    const verifier2 = await deploy("Verifier2");
    const verifier16 = await deploy("Verifier16");
    const hasher = await deploy("Hasher");

    const token = await deploy(
      "PermittableToken",
      "Wrapped ETH",
      "WETH",
      18,
      l1ChainId
    );
    await token.mint(sender.address, utils.parseEther("10000"));

    const amb = await deploy("MockAMB", gov.address, l1ChainId);
    const omniBridge = await deploy("MockOmniBridge", amb.address);

    /** @type {TornadoPool} */
    const tornadoPoolImpl = await deploy(
      "TornadoPool",
      verifier2.address,
      verifier16.address,
      MERKLE_TREE_HEIGHT,
      hasher.address,
      token.address,
      omniBridge.address,
      l1Unwrapper.address,
      gov.address,
      l1ChainId,
      multisig.address
    );

    const { data } = await tornadoPoolImpl.populateTransaction.initialize(
      MINIMUM_WITHDRAWAL_AMOUNT,
      MAXIMUM_DEPOSIT_AMOUNT
    );
    const proxy = await deploy(
      "CrossChainUpgradeableProxy",
      tornadoPoolImpl.address,
      gov.address,
      data,
      amb.address,
      l1ChainId
    );

    const tornadoPool = tornadoPoolImpl.attach(proxy.address);

    await token.approve(tornadoPool.address, utils.parseEther("10000"));

    return { tornadoPool, token, proxy, omniBridge, amb, gov, multisig };
  }

  it("[assignment] ii. deposit 0.1 ETH in L1 -> withdraw 0.08 ETH in L2 -> assert balances", async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture);

    // deposit 0.1
    const aliceKeypair = new Keypair(); // contains private and public keys
    const aliceDepositAmount = utils.parseEther("0.1");

    const aliceDepositUtxo = new Utxo({
      amount: aliceDepositAmount,
      keypair: aliceKeypair,
    });

    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    });

    const onTokenBridgedData = encodeDataForBridge({
      proof: args,
      extData,
    });

    const onTokenBridgedTx =
      await tornadoPool.populateTransaction.onTokenBridged(
        token.address,
        aliceDepositUtxo.amount,
        onTokenBridgedData
      );

    // emulating bridge. first it sends tokens to omnibridge mock then it sends to the pool
    await token.transfer(omniBridge.address, aliceDepositAmount);
    const transferTx = await token.populateTransaction.transfer(
      tornadoPool.address,
      aliceDepositAmount
    );

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data }, // send tokens to pool
      { who: tornadoPool.address, callData: onTokenBridgedTx.data }, // call onTokenBridgedTx
    ]);

    // withdraws a part of his funds from the shielded pool
    const aliceWithdrawAmount = utils.parseEther("0.08");
    const recipient = "0xDeaD00000000000000000000000000000000BEEf";
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(aliceWithdrawAmount),
      keypair: aliceKeypair,
    });

    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [aliceChangeUtxo],
      recipient: recipient,
      isL1Withdrawal: false,
    });

    //  check if alice balance is equal to the withdraw amount
    expect(await token.balanceOf(recipient)).to.be.equal(aliceWithdrawAmount);

    // check if omni bridge balance is 0
    expect(await token.balanceOf(omniBridge.address)).to.be.equal(0);

    // check if tornado pool balance is 0.02 ethers
    const expectedPoolBalance = utils.parseEther("0.02");
    expect(await token.balanceOf(tornadoPool.address)).to.be.equal(
      expectedPoolBalance
    );
  });

  it("[assignment] iii. Alice deposits 0.13 ETH in L1 -> Alice sends 0.06 ETH to Bob in L2-> Bob withdraws from L2 -> Alice withdraws from L1", async () => {
    // [assignment] complete code here
    const { tornadoPool, token, omniBridge } = await loadFixture(fixture);
    const aliceKeypair = new Keypair();
    const bobKeypair = new Keypair();

    // alice deposits 0.13

    const aliceDepositAmount = utils.parseEther("0.13");
    const aliceDepositUtxo = new Utxo({
      amount: aliceDepositAmount,
      keypair: aliceKeypair,
    });

    const { args, extData } = await prepareTransaction({
      tornadoPool,
      outputs: [aliceDepositUtxo],
    });
    const onTokenBridgedData = encodeDataForBridge({ proof: args, extData });
    const onTokenBridgedTx =
      await tornadoPool.populateTransaction.onTokenBridged(
        token.address,
        aliceDepositUtxo.amount,
        onTokenBridgedData
      );

    await token.transfer(omniBridge.address, aliceDepositAmount);
    const transferTx = await token.populateTransaction.transfer(
      tornadoPool.address,
      aliceDepositAmount
    );

    await omniBridge.execute([
      { who: token.address, callData: transferTx.data },
      { who: tornadoPool.address, callData: onTokenBridgedTx.data },
    ]);

    // alice sends 0.06 to bob on L2

    const sendAmount = utils.parseUnits("0.06");
    const sendUtxo = new Utxo({ amount: sendAmount, keypair: bobKeypair });
    const aliceChangeUtxo = new Utxo({
      amount: aliceDepositAmount.sub(sendAmount),
      keypair: aliceDepositUtxo.keypair,
    });

    // execute the transaction
    await transaction({
      tornadoPool,
      inputs: [aliceDepositUtxo],
      outputs: [sendUtxo, aliceChangeUtxo],
    });

    // bob withdraws from l2
    const bobBalanceUtxo = new Utxo({
      amount: sendAmount,
      keypair: bobKeypair,
      blinding: sendUtxo.blinding,
    });
    const bobRecipient = "0x0000000000000000000000000000000000000001";
    await transaction({
      tornadoPool,
      inputs: [bobBalanceUtxo],
      recipient: bobRecipient,
    });

    // alice withdraws from L1

    const aliceRecipient = "0x1234560000000000000000000000000000000002";
    await transaction({
      tornadoPool,
      inputs: [aliceChangeUtxo],
      recipient: aliceRecipient,
      isL1Withdrawal: true,
    });

    // expects

    // check bob balance
    expect(await token.balanceOf(bobRecipient)).to.be.equal(
      utils.parseUnits("0.06")
    );

    // check alice balance
    expect(await token.balanceOf(aliceRecipient)).to.be.equal(0);

    // check omni bridge balance
    expect(await token.balanceOf(omniBridge.address)).to.be.equal(
      utils.parseUnits("0.07")
    );

    // check pool balance
    expect(await token.balanceOf(tornadoPool.address)).to.be.equal(0);
  });
});
