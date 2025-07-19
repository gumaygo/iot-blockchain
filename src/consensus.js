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
    
    // Validate input parameters
    if (!localChain || !Array.isArray(localChain)) {
      console.warn('⚠️ Invalid local chain, returning empty chain');
      return [];
    }
    
    if (!remoteChains || !Array.isArray(remoteChains)) {
      console.warn('⚠️ Invalid remote chains, keeping local chain');
      return localChain;
    }
    
    // Filter out invalid chains
    const validRemoteChains = remoteChains.filter(chain => 
      chain && Array.isArray(chain) && chain.length > 0
    );
    
    console.log(`📊 Local chain length: ${localChain.length}`);
    console.log(`📊 Valid remote chains: ${validRemoteChains.length}`);
    
    // If no remote chains, keep local
    if (validRemoteChains.length === 0) {
      console.log('✅ No valid remote chains, keeping local chain');
      return localChain;
    }
    
    const allChains = [localChain, ...validRemoteChains];
    const validChains = allChains.filter(chain => {
      if (!chain || !Array.isArray(chain)) {
        console.warn('⚠️ Invalid chain found, skipping');
        return false;
      }
      return this.validateChain(chain);
    });
    
    if (validChains.length === 0) {
      console.warn('⚠️ No valid chains found, keeping local chain');
      return localChain;
    }
    
    console.log(`✅ Found ${validChains.length} valid chains`);
    
    // Sort chains by length (longest first)
    validChains.sort((a, b) => {
      if (!a || !b) return 0;
      return (b.length || 0) - (a.length || 0);
    });
    
    const longestChain = validChains[0];
    const secondLongest = validChains[1];
    
    if (!longestChain) {
      console.warn('⚠️ No valid longest chain found, keeping local chain');
      return localChain;
    }
    
    // If local chain is the longest, keep it
    if (longestChain === localChain) {
      console.log('✅ Local chain is longest, keeping it');
      return localChain;
    }
    
    // If longest chain is significantly longer, adopt it
    if (secondLongest && longestChain.length > secondLongest.length + 2) {
      console.log(`✅ Adopting longest chain (${longestChain.length} vs ${secondLongest.length})`);
      return longestChain;
    }
    
    // If chains are similar length, use hash-based tiebreaker
    if (secondLongest && longestChain.length === secondLongest.length) {
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
    
    // Only adopt remote if it's clearly better
    if (longestChain.length > localChain.length) {
      console.log(`✅ Adopting consensus chain (${longestChain.length} vs ${localChain.length})`);
      return longestChain;
    }
    
    // Default: keep local chain
    console.log('✅ Keeping local chain (no clear consensus winner)');
    return localChain;
  }

  // Calculate chain hash for tiebreaker
  calculateChainHash(chain) {
    if (!chain || !Array.isArray(chain) || chain.length === 0) {
      console.warn('⚠️ Invalid chain for hash calculation');
      return '';
    }
    
    try {
      const chainString = chain.map(block => block.hash || '').join('');
      return createHash('sha256').update(chainString).digest('hex');
    } catch (e) {
      console.error('❌ Error calculating chain hash:', e.message);
      return '';
    }
  }

  // Validate chain integrity
  validateChain(chain) {
    if (!Array.isArray(chain) || chain.length === 0) {
      console.warn('⚠️ Chain is not an array or empty');
      return false;
    }
    
    try {
      for (let i = 0; i < chain.length; i++) {
        const block = chain[i];
        
        // Basic structure validation
        if (!block || typeof block.index !== 'number' || 
            typeof block.hash !== 'string' || 
            typeof block.previousHash !== 'string') {
          console.warn(`❌ Invalid block structure at index ${i}`);
          return false;
        }
        
        // Index validation
        if (block.index !== i) {
          console.warn(`❌ Block index mismatch at ${i}: expected ${i}, got ${block.index}`);
          return false;
        }
        
        // Hash validation
        try {
          const expectedHash = createHash('sha256')
            .update(block.index + block.timestamp + block.data + block.previousHash)
            .digest('hex');
          
          if (block.hash !== expectedHash) {
            console.warn(`❌ Invalid block hash at index ${i}`);
            console.warn(`Expected: ${expectedHash}`);
            console.warn(`Got: ${block.hash}`);
            return false;
          }
        } catch (e) {
          console.warn(`❌ Hash calculation failed for block ${i}:`, e.message);
          return false;
        }
        
        // PreviousHash validation (except genesis)
        if (i > 0 && block.previousHash !== chain[i - 1].hash) {
          console.warn(`❌ Invalid previousHash at index ${i}`);
          return false;
        }
      }
      return true;
    } catch (e) {
      console.error('❌ Error validating chain:', e.message);
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