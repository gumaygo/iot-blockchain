// test-merkle.js - Debug Merkle tree validation
import { MerkleTree, ChainValidator } from './src/merkle-tree.js';
import { createHash } from 'crypto';

// Helper function to calculate hash
function calculateHash(block) {
  return createHash('sha256')
    .update(block.index + block.timestamp + block.data + block.previousHash)
    .digest('hex');
}

// Test data with correct hashes
const testBlocks = [
  {
    index: 0,
    timestamp: '2024-01-01T00:00:00.000Z',
    data: '{"message":"Genesis Block"}',
    previousHash: '0',
    hash: '' // Will be calculated
  },
  {
    index: 1,
    timestamp: '2024-01-01T00:01:00.000Z',
    data: '{"sensor_id":"validator-01","value":100}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  },
  {
    index: 2,
    timestamp: '2024-01-01T00:02:00.000Z',
    data: '{"sensor_id":"validator-01","value":200}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  },
  {
    index: 3,
    timestamp: '2024-01-01T00:03:00.000Z',
    data: '{"sensor_id":"validator-01","value":300}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  },
  {
    index: 4,
    timestamp: '2024-01-01T00:04:00.000Z',
    data: '{"sensor_id":"validator-01","value":400}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  },
  {
    index: 5,
    timestamp: '2024-01-01T00:05:00.000Z',
    data: '{"sensor_id":"validator-01","value":500}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  },
  {
    index: 6,
    timestamp: '2024-01-01T00:06:00.000Z',
    data: '{"sensor_id":"validator-01","value":600}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  },
  {
    index: 7,
    timestamp: '2024-01-01T00:07:00.000Z',
    data: '{"sensor_id":"validator-01","value":700}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  },
  {
    index: 8,
    timestamp: '2024-01-01T00:08:00.000Z',
    data: '{"sensor_id":"validator-01","value":800}',
    previousHash: '', // Will be set
    hash: '' // Will be calculated
  }
];

// Calculate correct hashes
console.log('🔧 Calculating correct hashes...\n');

for (let i = 0; i < testBlocks.length; i++) {
  const block = testBlocks[i];
  
  // Set previousHash (except genesis)
  if (i > 0) {
    block.previousHash = testBlocks[i - 1].hash;
  }
  
  // Calculate hash
  block.hash = calculateHash(block);
  
  console.log(`Block ${i}: ${block.hash.substring(0, 16)}...`);
}

console.log('\n🧪 Testing Merkle Tree Validation...\n');

// Test Merkle Tree
const merkleTree = new MerkleTree();
const chainValidator = new ChainValidator();

console.log('📊 Test chain length:', testBlocks.length);

// Build tree
merkleTree.buildTree(testBlocks);
console.log('🌳 Merkle root:', merkleTree.getRoot());
console.log('🌳 Tree height:', merkleTree.getHeight());
console.log('🌳 Tree size:', merkleTree.getSize());

// Test proof generation for block 8
console.log('\n🔍 Testing proof generation for block 8...');
try {
  const proof = merkleTree.generateProof(8);
  console.log('✅ Proof generated successfully');
  console.log('📋 Proof elements:', proof.length);
  
  // Test proof verification
  const isValid = merkleTree.verifyProof(
    testBlocks[8].hash,
    proof,
    merkleTree.getRoot()
  );
  console.log('✅ Proof verification result:', isValid);
} catch (e) {
  console.error('❌ Proof generation failed:', e.message);
}

// Test chain validation
console.log('\n🔍 Testing chain validation...');
const isValidChain = chainValidator.validateChainWithMerkle(testBlocks);
console.log('✅ Chain validation result:', isValidChain);

// Test simple validation
console.log('\n🔍 Testing simple validation...');
const isValidSimple = chainValidator.validateChainSimple(testBlocks);
console.log('✅ Simple validation result:', isValidSimple);

console.log('\n✅ Merkle tree test completed!'); 