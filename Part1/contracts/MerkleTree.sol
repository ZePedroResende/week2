//SPDX-License-Identifier: Unlicense
pragma solidity ^0.8.0;

import { PoseidonT3 } from "./Poseidon.sol"; //an existing library to perform Poseidon hash on solidity
import "./verifier.sol"; //inherits with the MerkleTreeInclusionProof verifier contract

contract MerkleTree is Verifier {
    uint256[] public hashes; // the Merkle tree in flattened array form
    uint256 public index = 0; // the current index of the first unfilled leaf
    uint256 public root; // the current Merkle root
    uint256 public n;

    constructor() {
        // [assignment] initialize a Merkle tree of 8 with blank leaves
        n = 3;
        hashes = new uint256[](2**(n+1)-1);

        uint256 previousIndex;
        uint256 nextIndex;
        uint256 heightIndex;
        uint256 a;
        uint256 b;

        for (uint256 height = n; height>0; height--) {
            previousIndex  = nextIndex;
            nextIndex = previousIndex + 2**height;
            heightIndex = 2**(height - 1);

            for (uint256 i= 0; i < heightIndex; i++) {

              if((previousIndex+i) % 2 == 0) {

                a = hashes[previousIndex+i];
                b = hashes[previousIndex+i+1];

              } else {

                a = hashes[previousIndex+i - 1];
                b = hashes[previousIndex+i];
              }

                hashes[nextIndex + i] = PoseidonT3.poseidon([a,b]);
            }
        }

        root = hashes[hashes.length - 1];
    }

    function insertLeaf(uint256 hashedLeaf) public returns (uint256) {
        // [assignment] insert a hashed leaf into the Merkle tree

        uint256 next;
        uint256 i = index;
        uint256 a;
        uint256 b;

        hashes[index] = hashedLeaf;

        for (uint256 height = n; height>0; height--) {

            if((next+i) % 2 == 0) {

              a = hashes[next+i];
              b = hashes[next+i+1];

            } else {

              a = hashes[next+i - 1];
              b = hashes[next+i];
            }

            next = next + 2**height;
            i = i/2;
            hashes[next + i] = PoseidonT3.poseidon([a,b]);
        }

        root = hashes[hashes.length - 1];

        index++;

        return index;
    }

    function verify(
            uint[2] memory a,
            uint[2][2] memory b,
            uint[2] memory c,
            uint[1] memory input
        ) public view returns (bool) {

        // [assignment] verify an inclusion proof and check that the proof root matches current root

        return input[0] == root && verifyProof(a,b,c,input);
    }
}
