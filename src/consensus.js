// src/consensus.js - Consensus Algorithm untuk resolve conflicts
import { createHash } from 'crypto';

export class ConsensusManager {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.conflictResolutionTimeout = 5000; // 5 detik timeout
    this.minimumConsensus = 0.51; // 51% consensus
  }

  // Consensus algorithm: Longest Valid Chain Rule
  async resolveChainConflict(localChain, remoteChains) {
    console.log('🔍 Starting consensus resolution...');
    
    const allChains = [localChain, ...remoteChains];
    const validChains = allChains.filter(chain => this.validateChain(chain));
    
    if (validChains.length === 0) {
      console.warn('⚠️ No valid chains found, keeping local chain');
      return localChain;
    }
    
    // Sort chains by length (longest first)
    validChains.sort((a, b) => b.length - a.length);
    
    const longestChain = validChains[0];
    const secondLongest = validChains[1];
    
    // If longest chain is significantly longer, adopt it
    if (longestChain.length > secondLongest.length + 2) {
      console.log(`✅ Adopting longest chain (${longestChain.length} vs ${secondLongest.length})`);
      return longestChain;
    }
    
    // If chains are similar length, use hash-based tiebreaker
    if (longestChain.length === secondLongest.length) {
      const longestHash = this.calculateChainHash(longestChain);
      const secondHash = this.calculateChainHash(secondLongest);
      
      if (longestHash > secondHash) {
        console.log('✅ Using hash-based tiebreaker for longest chain');
        return longestChain;
      }
    }
    
    // If local chain is among the longest, keep it
    if (longestChain === localChain) {
      console.log('✅ Keeping local chain (among longest)');
      return localChain;
    }
    
    console.log(`✅ Adopting consensus chain (${longestChain.length} blocks)`);
    return longestChain;
  }

  // Calculate chain hash for tiebreaker
  calculateChainHash(chain) {
    const chainString = chain.map(block => block.hash).join('');
    return createHash('sha256').update(chainString).digest('hex');
  }

  // Validate chain integrity
  validateChain(chain) {
    if (!Array.isArray(chain) || chain.length === 0) return false;
    
    try {
      for (let i = 0; i < chain.length; i++) {
        const block = chain[i];
        
        // Basic structure validation
        if (!block || typeof block.index !== 'number' || 
            typeof block.hash !== 'string' || 
            typeof block.previousHash !== 'string') {
          return false;
        }
        
        // Index validation
        if (block.index !== i) return false;
        
        // Hash validation
        const expectedHash = createHash('sha256')
          .update(block.index + block.timestamp + block.data + block.previousHash)
          .digest('hex');
        
        if (block.hash !== expectedHash) return false;
        
        // PreviousHash validation (except genesis)
        if (i > 0 && block.previousHash !== chain[i-1].hash) return false;
      }
      return true;
    } catch (e) {
      return false;
    }
  }

  // Merge conflicting blocks using consensus
  async mergeConflictingBlocks(localChain, remoteChain) {
    console.log('🔄 Merging conflicting chains...');
    
    // Find divergence point
    let divergenceIndex = -1;
    for (let i = 0; i < Math.min(localChain.length, remoteChain.length); i++) {
      if (localChain[i].hash !== remoteChain[i].hash) {
        divergenceIndex = i;
        break;
      }
    }
    
    if (divergenceIndex === -1) {
      console.log('ℹ️ No divergence found, chains are compatible');
      return { action: 'none', chain: localChain };
    }
    
    console.log(`🔍 Divergence detected at block ${divergenceIndex}`);
    
    // Use consensus to decide which chain to keep
    const consensusChain = await this.resolveChainConflict(localChain, [remoteChain]);
    
    if (consensusChain === localChain) {
      return { action: 'keep_local', chain: localChain };
    } else {
      return { action: 'adopt_remote', chain: remoteChain };
    }
  }
} 