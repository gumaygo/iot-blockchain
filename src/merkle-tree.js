// src/merkle-tree.js - Merkle Tree untuk efficient chain validation
import { createHash } from 'crypto';

export class MerkleTree {
  constructor() {
    this.leaves = [];
    this.root = null;
  }

  // Build Merkle tree from blocks
  buildTree(blocks) {
    if (!blocks || blocks.length === 0) {
      this.root = null;
      return;
    }

    // Create leaf nodes from block hashes
    this.leaves = blocks.map(block => block.hash);
    
    // Build tree bottom-up
    this.root = this.buildTreeFromLeaves(this.leaves);
  }

  // Build tree from leaf hashes
  buildTreeFromLeaves(leaves) {
    if (leaves.length === 1) {
      return leaves[0];
    }

    const parents = [];
    
    // Process pairs of leaves
    for (let i = 0; i < leaves.length; i += 2) {
      const left = leaves[i];
      const right = i + 1 < leaves.length ? leaves[i + 1] : left;
      
      const parentHash = createHash('sha256')
        .update(left + right)
        .digest('hex');
      
      parents.push(parentHash);
    }

    // Recursively build upper levels
    return this.buildTreeFromLeaves(parents);
  }

  // Get Merkle root
  getRoot() {
    return this.root;
  }

  // Generate proof for specific block
  generateProof(blockIndex) {
    if (blockIndex >= this.leaves.length) {
      throw new Error('Block index out of range');
    }

    const proof = [];
    let currentIndex = blockIndex;
    let currentLevel = this.leaves;

    while (currentLevel.length > 1) {
      const isRight = currentIndex % 2 === 1;
      const siblingIndex = isRight ? currentIndex - 1 : currentIndex + 1;
      
      if (siblingIndex < currentLevel.length) {
        proof.push({
          hash: currentLevel[siblingIndex],
          position: isRight ? 'left' : 'right'
        });
      }

      // Move to parent level
      currentIndex = Math.floor(currentIndex / 2);
      currentLevel = this.buildNextLevel(currentLevel);
    }

    return proof;
  }

  // Build next level of tree
  buildNextLevel(level) {
    const nextLevel = [];
    
    for (let i = 0; i < level.length; i += 2) {
      const left = level[i];
      const right = i + 1 < level.length ? level[i + 1] : left;
      
      const parentHash = createHash('sha256')
        .update(left + right)
        .digest('hex');
      
      nextLevel.push(parentHash);
    }

    return nextLevel;
  }

  // Verify proof
  verifyProof(blockHash, proof, root) {
    let currentHash = blockHash;

    for (const proofElement of proof) {
      if (proofElement.position === 'left') {
        currentHash = createHash('sha256')
          .update(proofElement.hash + currentHash)
          .digest('hex');
      } else {
        currentHash = createHash('sha256')
          .update(currentHash + proofElement.hash)
          .digest('hex');
      }
    }

    return currentHash === root;
  }

  // Get tree height
  getHeight() {
    if (!this.root) return 0;
    
    let height = 0;
    let levelSize = this.leaves.length;
    
    while (levelSize > 1) {
      height++;
      levelSize = Math.ceil(levelSize / 2);
    }
    
    return height;
  }

  // Get tree size (number of nodes)
  getSize() {
    if (!this.root) return 0;
    
    let size = this.leaves.length;
    let levelSize = this.leaves.length;
    
    while (levelSize > 1) {
      levelSize = Math.ceil(levelSize / 2);
      size += levelSize;
    }
    
    return size;
  }
}

export class ChainValidator {
  constructor() {
    this.merkleTree = new MerkleTree();
  }

  // Validate chain using Merkle tree
  validateChainWithMerkle(chain) {
    if (!chain || chain.length === 0) return false;

    try {
      // Build Merkle tree from chain
      this.merkleTree.buildTree(chain);
      
      // Validate each block
      for (let i = 0; i < chain.length; i++) {
        const block = chain[i];
        
        // Basic validation
        if (!this.validateBlock(block, i)) {
          return false;
        }
        
        // Generate and verify Merkle proof
        const proof = this.merkleTree.generateProof(i);
        const isValidProof = this.merkleTree.verifyProof(
          block.hash, 
          proof, 
          this.merkleTree.getRoot()
        );
        
        if (!isValidProof) {
          console.warn(`❌ Invalid Merkle proof for block ${i}`);
          return false;
        }
      }
      
      return true;
    } catch (e) {
      console.error('❌ Error validating chain with Merkle tree:', e.message);
      return false;
    }
  }

  // Validate individual block
  validateBlock(block, index) {
    // Structure validation
    if (!block || typeof block.index !== 'number' || 
        typeof block.hash !== 'string' || 
        typeof block.previousHash !== 'string') {
      return false;
    }
    
    // Index validation
    if (block.index !== index) {
      return false;
    }
    
    // Hash validation
    const expectedHash = createHash('sha256')
      .update(block.index + block.timestamp + block.data + block.previousHash)
      .digest('hex');
    
    if (block.hash !== expectedHash) {
      return false;
    }
    
    return true;
  }

  // Get Merkle root for chain
  getMerkleRoot(chain) {
    this.merkleTree.buildTree(chain);
    return this.merkleTree.getRoot();
  }

  // Compare chains using Merkle roots
  compareChains(chain1, chain2) {
    const root1 = this.getMerkleRoot(chain1);
    const root2 = this.getMerkleRoot(chain2);
    
    return {
      areEqual: root1 === root2,
      root1,
      root2
    };
  }
} 