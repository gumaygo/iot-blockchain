import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { Blockchain } from './blockchain.js';
import { ConsensusManager } from './consensus.js';
import { PeerDiscovery } from './peer-discovery.js';
import { ChainValidator } from './merkle-tree.js';
import fs from 'fs';
import { createHash } from 'crypto';

const packageDef = protoLoader.loadSync('./proto/blockchain.proto');
const grpcObj = grpc.loadPackageDefinition(packageDef);
const BlockchainService = grpcObj.blockchain.Blockchain;

const ca = fs.readFileSync('./key/ca.crt');
const clientKey = fs.readFileSync('./key/client.key');
const clientCert = fs.readFileSync('./key/client.crt');
const credentials = grpc.credentials.createSsl(ca, clientKey, clientCert);

// Initialize optimization components
let consensusManager = null;
let peerDiscovery = null;
let chainValidator = null;

export function initializeOptimizations(blockchain) {
  consensusManager = new ConsensusManager(blockchain);
  peerDiscovery = new PeerDiscovery();
  chainValidator = new ChainValidator();
  
  // Start peer discovery
  peerDiscovery.startDiscovery();
  
  console.log('🚀 Blockchain optimizations initialized');
}

export function getPeers() {
  return peerDiscovery ? peerDiscovery.getHealthyPeers() : [];
}

export async function syncChain(blockchain) {
  if (!consensusManager || !peerDiscovery || !chainValidator) {
    console.warn('⚠️ Optimizations not initialized, using fallback sync');
    return await fallbackSync(blockchain);
  }

  const localChain = blockchain.getChain();
  let hasChanges = false;
  const remoteChains = [];
  
  // Get healthy peers only
  const healthyPeers = peerDiscovery.getHealthyPeers();
  console.log(`🔗 Syncing with ${healthyPeers.length} healthy peers`);
  
  for (const peer of healthyPeers) {
    const client = new BlockchainService(peer, credentials);
    console.log(`🔗 Sync ke peer: ${peer}`);
    
    try {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Sync timeout'));
        }, 5000);

        client.GetBlockchain({}, (err, response) => {
          clearTimeout(timeout);
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        });
      });

      const remoteChain = response.chain;
      console.log(`Peer ${peer} chain length: ${remoteChain.length}`);
      
      // Validate chain using Merkle tree
      if (remoteChain.length > 0) {
        console.log(`🔍 Validating remote chain from ${peer} with Merkle tree...`);
        
        // Use simple validation for small chains, Merkle for larger chains
        let isValid;
        if (remoteChain.length < 4) {
          console.log(`ℹ️ Using simple validation for small chain (${remoteChain.length} blocks)`);
          isValid = chainValidator.validateChainSimple(remoteChain);
        } else {
          isValid = chainValidator.validateChainWithMerkle(remoteChain);
        }
        
        console.log(`✅ Remote chain validation result: ${isValid}`);
        
        if (isValid) {
          remoteChains.push(remoteChain);
        } else {
          console.warn('⚠️ Remote chain invalid, skipping...');
        }
      }
      
    } catch (error) {
      console.warn(`❌ Failed to sync from ${peer}:`, error.message);
      // Mark peer as unhealthy
      peerDiscovery.peers.set(peer, {
        ...peerDiscovery.peers.get(peer),
        health: 'unhealthy',
        lastSeen: Date.now()
      });
    }
  }
  
  if (remoteChains.length === 0) {
    console.log('ℹ️ No valid remote chains available for sync');
    return;
  }
  
  // Use consensus to resolve conflicts
  console.log('🔍 Applying consensus algorithm...');
  const consensusChain = await consensusManager.resolveChainConflict(localChain, remoteChains);
  
  if (consensusChain !== localChain) {
    console.log('🔄 Consensus decided to adopt remote chain');
    await adoptConsensusChain(blockchain, consensusChain);
    hasChanges = true;
  } else {
    console.log('✅ Consensus decided to keep local chain');
  }
  
  if (hasChanges) {
    console.log(`🔄 Optimized sync completed with consensus`);
  } else {
    console.log(`ℹ️ Optimized sync completed - all nodes in consensus`);
  }
}

// Adopt consensus chain
async function adoptConsensusChain(blockchain, consensusChain) {
  console.log('🔄 Adopting consensus chain...');
  
  // Clear existing blocks (except genesis)
  blockchain.db.prepare('DELETE FROM block WHERE idx > 0').run();
  
  // Insert consensus blocks
  for (let i = 1; i < consensusChain.length; i++) {
    const block = consensusChain[i];
    try {
      blockchain.db.prepare('INSERT INTO block (idx, timestamp, data, previousHash, hash) VALUES (?, ?, ?, ?, ?)')
        .run(block.index, block.timestamp, block.data, block.previousHash, block.hash);
      console.log(`✅ Adopted block ${block.index}`);
    } catch (e) {
      console.warn(`⚠️ Failed to adopt block ${block.index}:`, e.message);
    }
  }
  
  console.log(`✅ Consensus chain adopted (${consensusChain.length} blocks)`);
}

// Fallback sync for when optimizations are not available
async function fallbackSync(blockchain) {
  const localChain = blockchain.getChain();
  let hasChanges = false;
  
  const peers = JSON.parse(fs.readFileSync('./peers.json', 'utf-8'));
  
  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);
    console.log(`🔗 Fallback sync ke peer: ${peer}`);
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(`⏰ Timeout sync dari ${peer}`);
        resolve();
      }, 3000);

      client.GetBlockchain({}, async (err, response) => {
        clearTimeout(timeout);
        if (err) {
          console.warn(`❌ Failed to sync from ${peer}:`, err.message);
          return resolve();
        }

        const remoteChain = response.chain;
        console.log(`Peer ${peer} chain length: ${remoteChain.length}`);
        console.log(`Local chain length: ${localChain.length}`);
        
        if (remoteChain.length > 0) {
          console.log(`🔍 Validating remote chain from ${peer}...`);
          const isValid = validateChain(remoteChain);
          console.log(`✅ Remote chain validation result: ${isValid}`);
          
          if (isValid) {
            try {
              const changes = await blockchainSync(blockchain, localChain, remoteChain);
              
              if (changes.inserted > 0) {
                console.log(`🔄 Fallback sync from ${peer} ✅ (inserted: ${changes.inserted} blocks)`);
                hasChanges = true;
              } else if (changes.conflicts > 0) {
                console.log(`⚠️ Sync completed with ${changes.conflicts} conflicts (no data lost)`);
              } else {
                console.log(`ℹ️ No new blocks to sync from ${peer}`);
              }
            } catch (e) {
              console.error('❌ Error during fallback sync:', e.message);
            }
          } else {
            console.warn('⚠️ Remote chain invalid, not syncing!');
          }
        }
        resolve();
      });
    });
  }
  
  if (hasChanges) {
    console.log(`🔄 Fallback sync completed with new blocks`);
  } else {
    console.log(`ℹ️ Fallback sync completed - all nodes in sync`);
  }
}

export async function broadcastBlock(block, blockchain) {
  if (!peerDiscovery) {
    console.warn('⚠️ Peer discovery not initialized, using fallback broadcast');
    return await fallbackBroadcast(block);
  }

  console.log(`🔄 Starting optimized broadcast for block ${block.index}...`);
  
  const localChain = blockchain.getChain();
  const localLength = localChain.length;
  const healthyPeers = peerDiscovery.getHealthyPeers();
  
  console.log(`📡 Broadcasting block ${block.index} to ${healthyPeers.length} healthy peers`);
  
  let broadcastCount = 0;
  const broadcastPromises = [];
  
  for (const peer of healthyPeers) {
    const peerInfo = peerDiscovery.getPeerInfo(peer);
    
    // Smart broadcast logic with peer health
    if (peerInfo.chainLength >= localLength) {
      console.log(`⏭️ Skipping ${peer} - already has block ${block.index} (chain length: ${peerInfo.chainLength})`);
      continue;
    }
    
    if (peerInfo.chainLength < block.index - 1) {
      console.log(`⏳ ${peer} chain too short (${peerInfo.chainLength}), needs sync first`);
      continue;
    }
    
    // Convert block untuk kompatibilitas dengan proto
    const protoBlock = {
      index: block.index,
      timestamp: block.timestamp,
      data: JSON.stringify(block.data),
      hash: block.hash,
      previousHash: block.previousHash
    };
    
    // Broadcast block with timeout
    const broadcastPromise = new Promise(async (resolve) => {
      try {
        const client = new BlockchainService(peer, credentials);
        
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => {
            reject(new Error('Broadcast timeout'));
          }, 3000);
          
          client.AddBlock(protoBlock, (err, response) => {
            clearTimeout(timeout);
            if (err) {
              console.warn(`❌ Failed to broadcast to ${peer}:`, err.message);
              reject(err);
            } else {
              console.log(`✅ Block ${block.index} broadcasted to ${peer}`);
              broadcastCount++;
              resolve();
            }
          });
        });
        
        resolve();
      } catch (error) {
        console.warn(`⚠️ Error broadcasting to ${peer}:`, error.message);
        resolve();
      }
    });
    
    broadcastPromises.push(broadcastPromise);
  }
  
  // Wait for all broadcasts to complete
  await Promise.allSettled(broadcastPromises);
  
  console.log(`✅ Optimized broadcast completed for block ${block.index} (${broadcastCount}/${healthyPeers.length} peers)`);
}

// Fallback broadcast
async function fallbackBroadcast(block) {
  const peers = JSON.parse(fs.readFileSync('./peers.json', 'utf-8'));
  console.log(`📡 Fallback broadcasting block ${block.index} to ${peers.length} peers`);
  
  let broadcastCount = 0;
  
  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);
    
    try {
      const protoBlock = {
        index: block.index,
        timestamp: block.timestamp,
        data: JSON.stringify(block.data),
        hash: block.hash,
        previousHash: block.previousHash
      };
      
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Broadcast timeout'));
        }, 3000);
        
        client.AddBlock(protoBlock, (err, response) => {
          clearTimeout(timeout);
          if (err) {
            console.warn(`❌ Failed to broadcast to ${peer}:`, err.message);
            reject(err);
          } else {
            console.log(`✅ Block ${block.index} broadcasted to ${peer}`);
            broadcastCount++;
            resolve();
          }
        });
      });
      
    } catch (error) {
      console.warn(`⚠️ Error broadcasting to ${peer}:`, error.message);
    }
  }
  
  console.log(`✅ Fallback broadcast completed for block ${block.index} (${broadcastCount}/${peers.length} peers)`);
}

// Legacy blockchain sync function (for fallback)
async function blockchainSync(blockchain, localChain, remoteChain) {
  const changes = { inserted: 0, conflicts: 0 };
  
  const existingBlocks = new Map();
  localChain.forEach(block => {
    existingBlocks.set(block.index, block.hash);
  });
  
  console.log(`📊 Local blocks: ${localChain.length}, Remote blocks: ${remoteChain.length}`);
  
  let highestCommonIndex = -1;
  for (let i = 0; i < Math.min(localChain.length, remoteChain.length); i++) {
    if (localChain[i].hash === remoteChain[i].hash) {
      highestCommonIndex = i;
    } else {
      break;
    }
  }
  
  console.log(`🔗 Highest common block index: ${highestCommonIndex}`);
  
  for (const remoteBlock of remoteChain) {
    const existingHash = existingBlocks.get(remoteBlock.index);
    
    if (!existingHash) {
      try {
        if (remoteBlock.index > 0) {
          const prevBlock = blockchain.db.prepare('SELECT * FROM block WHERE idx = ?').get(remoteBlock.index - 1);
          if (!prevBlock) {
            console.warn(`⚠️ Block ${remoteBlock.index} previous block missing, skipping`);
            continue;
          }
          if (prevBlock.hash !== remoteBlock.previousHash) {
            console.warn(`⚠️ Block ${remoteBlock.index} previousHash mismatch, skipping`);
            continue;
          }
        }
        
        blockchain.db.prepare('INSERT INTO block (idx, timestamp, data, previousHash, hash) VALUES (?, ?, ?, ?, ?)')
          .run(remoteBlock.index, remoteBlock.timestamp, remoteBlock.data, remoteBlock.previousHash, remoteBlock.hash);
        
        changes.inserted++;
        console.log(`✅ Appended block ${remoteBlock.index} from peer`);
      } catch (e) {
        if (e.message.includes('UNIQUE constraint failed')) {
          console.log(`ℹ️ Block ${remoteBlock.index} already exists, skipping...`);
        } else {
          console.warn(`⚠️ Failed to append block ${remoteBlock.index}:`, e.message);
        }
      }
    } else if (existingHash !== remoteBlock.hash) {
      changes.conflicts++;
      console.warn(`⚠️ Block ${remoteBlock.index} conflict detected (local: ${existingHash.substring(0, 8)}..., remote: ${remoteBlock.hash.substring(0, 8)}...)`);
      console.warn(`ℹ️ Keeping local block (blockchain immutability principle)`);
      console.warn(`🛑 Chain divergence detected at block ${remoteBlock.index}, stopping sync`);
      break;
    } else {
      console.log(`ℹ️ Block ${remoteBlock.index} already exists and identical`);
    }
  }
  
  return changes;
}

function validateChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return false;
  
  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    
    if (typeof block !== 'object' || 
        typeof block.index !== 'number' || 
        typeof block.hash !== 'string' || 
        typeof block.previousHash !== 'string' || 
        typeof block.data !== 'string' || 
        typeof block.timestamp !== 'string') {
      console.warn(`❌ Invalid block structure at index ${i}`);
      return false;
    }
    
    if (block.index !== i) {
      console.warn(`❌ Block index mismatch at ${i}: expected ${i}, got ${block.index}`);
      return false;
    }
    
    let parsedData;
    try {
      parsedData = JSON.parse(block.data);
    } catch (e) {
      console.warn(`❌ Invalid JSON data at index ${i}`);
      return false;
    }
    
    const expectedHash = createHash('sha256')
      .update(block.index + block.timestamp + block.data + block.previousHash)
      .digest('hex');
    
    if (block.hash !== expectedHash) {
      console.warn(`❌ Invalid block hash at index ${i}`);
      console.warn(`Expected: ${expectedHash}`);
      console.warn(`Got: ${block.hash}`);
      return false;
    }
    
    if (i > 0 && block.previousHash !== chain[i - 1].hash) {
      console.warn(`❌ Invalid previousHash at index ${i}`);
      return false;
    }
  }
  return true;
}

