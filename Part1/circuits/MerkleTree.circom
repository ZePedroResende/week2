pragma circom 2.0.0;
include "../node_modules/circomlib/circuits/mux1.circom";
include "../node_modules/circomlib/circuits/poseidon.circom";


template HashTwoElements() {
  signal input first;
  signal input second;
  signal output out;

  component poseidon  = Poseidon(2);

  poseidon.inputs[0] <== first;
  poseidon.inputs[1] <== second;


  out <==  poseidon.out;

}

template CheckRoot(n) { // compute the root of a MerkleTree of n Levels
    signal input leaves[2**n];
    signal output root;

    //[assignment] insert your code here to calculate the Merkle root from 2^n leaves

    var numberOfHashes = 2**(n+1)-1;
    var numberOfLeaves= 2**n;

    component hashes[numberOfHashes];

    for (var i = 0; i < numberOfLeaves; i++) {
        hashes[i] = HashTwoElements();
        hashes[i].first <== leaves[i];
        hashes[i].second <== leaves[i];
    }

    for (var i = numberOfLeaves; i < numberOfHashes; i++) {
        hashes[i] = HashTwoElements();
        hashes[i].first <== hashes[(i - numberOfLeaves)*2].out;
        hashes[i].second <== hashes[(i - numberOfLeaves)*2+1].out;
    }


    root <== hashes[numberOfHashes-1].out;
}


// template DualMux seen on
// https://github.com/tornadocash/tornado-core/blob/master/circuits/merkleTree.circom
// if s == 0 returns [in[0], in[1]]
// if s == 1 returns [in[1], in[0]]
template DualMux() {
    signal input in[2];
    signal input s;
    signal output out[2];

    s * (1 - s) === 0;
    out[0] <== (in[1] - in[0])*s + in[0];
    out[1] <== (in[0] - in[1])*s + in[1];
}


template MerkleTreeInclusionProof(n) {
    signal input leaf;
    signal input path_elements[n];
    signal input path_index[n]; // path index are 0's and 1's indicating whether the current element is on the left or right
    signal output root; // note that this is an OUTPUT signal

    //[assignment] insert your code here to compute the root from a leaf and elements along the path

// line 73 to 90 seen on
// https://github.com/tornadocash/tornado-core/blob/master/circuits/merkleTree.circom
// line 36 to 50
    component selectors[n];
    component hashers[n];

    for (var i = 0; i < n; i++) {
        selectors[i] = DualMux();
        selectors[i].in[0] <== i == 0 ? leaf : hashers[i - 1].out;
        selectors[i].in[1] <== path_elements[i];
        selectors[i].s <== path_index[i];

        hashers[i] = HashTwoElements();
        hashers[i].first  <== selectors[i].out[0];
        hashers[i].second <== selectors[i].out[1];
    }

    root <== hashers[n- 1].out;
}
