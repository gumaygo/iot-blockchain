import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { Blockchain } from './blockchain.js';
import { ConsensusManager } from './consensus.js';
import { PeerDiscovery } from './peer-discovery.js';
import { ChainValidator } from './merkle-tree.js';
import fs from 'fs';
import path from 'path';
import { clientCredentials } from './grpc-server.js';

const __dirname = path.resolve();

// Load proto
const packageDefinition = protoLoader.loadSync(
  path.join(__dirname, 'proto', 'blockchain.proto'),
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  }
);
const grpcObject = grpc.loadPackageDefinition(packageDefinition);
const BlockchainService = grpcObject.blockchain.Blockchain;

// Use client credentials from grpc-server
const credentials = clientCredentials;

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
  try {
    // Check if database is empty
    const blockCount = blockchain.db.prepare('SELECT COUNT(*) as count FROM blocks').get();
    if (blockCount.count === 0) {
      console.log('📋 Database is empty, attempting to sync from network...');
    }
    
    console.log('🔄 Syncing with healthy peers...');
    const peers = await getHealthyPeers();
    
    if (peers.length === 0) {
      console.log('⚠️ No healthy peers available for sync');
      throw new Error('No healthy peers available');
    }
    
    console.log(`🔄 Syncing with ${peers.length} healthy peers`);
    
    const remoteChains = [];
    
    for (const peer of peers) {
      try {
        console.log(`🔄 Sync ke peer: ${peer}`);
        const remoteChain = await getRemoteChain(peer);
        
        if (remoteChain && remoteChain.length > 0) {
          console.log(`Peer ${peer} chain length: ${remoteChain.length}`);
          remoteChains.push(remoteChain);
        }
      } catch (error) {
        console.error(`❌ Failed to sync from ${peer}:`, error.message);
      }
    }
    
    if (remoteChains.length === 0) {
      console.log('⚠️ No valid remote chains received');
      throw new Error('No valid remote chains received');
    }
    
    console.log(`✅ Received ${remoteChains.length} remote chains`);
    
    // Apply consensus algorithm
    const consensusManager = new ConsensusManager();
    const localChain = blockchain.getChain();
    const consensusChain = await consensusManager.resolveChainConflict(localChain, remoteChains);
    
    // Apply consensus result
    if (consensusChain !== localChain) {
      console.log('🔄 Consensus decided to adopt remote chain');
      await blockchain.replaceChain(consensusChain);
    } else {
      console.log('✅ Consensus decided to keep local chain');
    }
    
    console.log('✅ Sync completed successfully');
  } catch (error) {
    console.error('❌ Sync failed:', error.message);
    throw error;
  }
}

// Adopt consensus chain
async function adoptConsensusChain(blockchain, consensusChain) {
  console.log('🔄 Adopting consensus chain...');
  
  // Clear existing blocks (except genesis)
        blockchain.db.prepare('DELETE FROM blocks WHERE idx > 0').run();
  
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
  try {
    console.log(`🔄 Starting optimized broadcast for block ${block.index}...`);
    
    // Use peer discovery if available
    let peers = [];
    if (global.peerDiscovery) {
      peers = global.peerDiscovery.getHealthyPeers();
      console.log(`📡 Broadcasting block ${block.index} to ${peers.length} healthy peers`);
    } else {
      console.warn('⚠️ Peer discovery not initialized, using fallback broadcast');
      peers = await getHealthyPeers();
      console.log(`📡 Fallback broadcasting block ${block.index} to ${peers.length} peers`);
    }
    
    if (peers.length === 0) {
      console.log('⚠️ No peers available for broadcast');
      return;
    }
    
    let successCount = 0;
    const promises = peers.map(async (peer) => {
      try {
        const client = new BlockchainService(peer, clientCredentials);
        await new Promise((resolve, reject) => {
          const timeout = setTimeout(() => reject(new Error('Broadcast timeout')), 5000);
          
          client.AddBlock({
            index: block.index,
            timestamp: block.timestamp,
            data: JSON.stringify(block.data),
            previousHash: block.previousHash,
            hash: block.hash
          }, (err, response) => {
            clearTimeout(timeout);
            if (err) {
              reject(err);
            } else {
              resolve(response);
            }
          });
        });
        
        console.log(`✅ Block ${block.index} broadcasted to ${peer}`);
        successCount++;
      } catch (error) {
        console.error(`❌ Failed to broadcast to ${peer}:`, error.message);
        console.warn(`⚠️ Error broadcasting to ${peer}:`, error.message);
      }
    });
    
    await Promise.allSettled(promises);
    console.log(`✅ Optimized broadcast completed for block ${block.index} (${successCount}/${peers.length} peers)`);
  } catch (error) {
    console.error('❌ Broadcast error:', error.message);
  }
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
          const prevBlock = blockchain.db.prepare('SELECT * FROM blocks WHERE idx = ?').get(remoteBlock.index - 1);
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

// Helper function untuk get healthy peers
async function getHealthyPeers() {
  // Use peer discovery if available, otherwise fallback to static peers
  if (global.peerDiscovery) {
    return global.peerDiscovery.getHealthyPeers();
  }
  
  // Fallback to static peers (exclude self)
  const peers = [
    '172.16.2.248:50051',
    '172.16.2.253:50051', 
    '172.16.2.254:50051'
  ];
  
  const nodeAddress = process.env.NODE_ADDRESS || '172.16.1.253:50051';
  const filteredPeers = peers.filter(peer => peer !== nodeAddress);
  
  const healthyPeers = [];
  
  for (const peer of filteredPeers) {
    try {
      const client = new BlockchainService(peer, clientCredentials);
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Health check timeout')), 3000);
        client.GetBlockchain({}, (err) => {
          clearTimeout(timeout);
          if (err) reject(err);
          else resolve();
        });
      });
      healthyPeers.push(peer);
    } catch (error) {
      console.log(`❌ Peer ${peer} unhealthy: ${error.message}`);
    }
  }
  
  return healthyPeers;
}

// Helper function untuk get remote chain
async function getRemoteChain(peer) {
  const client = new BlockchainService(peer, credentials);
  
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Sync timeout')), 5000);
    
    client.GetBlockchain({}, (err, response) => {
      clearTimeout(timeout);
      if (err) {
        reject(err);
      } else {
        resolve(response.chain || []);
      }
    });
  });
}

