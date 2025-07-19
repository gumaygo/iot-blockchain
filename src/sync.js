import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { Blockchain } from './blockchain.js';
import fs from 'fs';
import { createHash } from 'crypto';

const packageDef = protoLoader.loadSync('./proto/blockchain.proto');
const grpcObj = grpc.loadPackageDefinition(packageDef);
const BlockchainService = grpcObj.blockchain.Blockchain;

const peers = JSON.parse(fs.readFileSync('./peers.json', 'utf-8'));
const ca = fs.readFileSync('./key/ca.crt');
const clientKey = fs.readFileSync('./key/client.key');
const clientCert = fs.readFileSync('./key/client.crt');
const credentials = grpc.credentials.createSsl(ca, clientKey, clientCert);

export function getPeers() {
  return peers;
}

export async function syncChain(blockchain) {
  const localChain = blockchain.getChain();
  let hasChanges = false;
  
  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);
    console.log(`🔗 Sync ke peer: ${peer}`);
    await new Promise((resolve) => {
      // Set timeout 3 detik
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
        
        // Validasi chain dari peer
        if (remoteChain.length > 0) {
          console.log(`🔍 Validating remote chain from ${peer}...`);
          const isValid = validateChain(remoteChain);
          console.log(`✅ Remote chain validation result: ${isValid}`);
          
          if (isValid) {
            try {
              // Blockchain sync: hanya append missing blocks, tidak ada delete
              const changes = await blockchainSync(blockchain, localChain, remoteChain);
              
              if (changes.inserted > 0) {
                console.log(`🔄 Blockchain sync from ${peer} ✅ (inserted: ${changes.inserted} blocks)`);
                hasChanges = true;
              } else if (changes.conflicts > 0) {
                console.log(`⚠️ Sync completed with ${changes.conflicts} conflicts (no data lost)`);
              } else {
                console.log(`ℹ️ No new blocks to sync from ${peer}`);
              }
            } catch (e) {
              console.error('❌ Error during blockchain sync:', e.message);
            }
          } else {
            console.warn('⚠️ Remote chain invalid, not syncing!');
          }
        }
        resolve();
      });
    });
    console.log(`🔚 Selesai mencoba sync ke peer: ${peer}`);
  }
  
  if (hasChanges) {
    console.log(`🔄 Blockchain sync completed with new blocks`);
  } else {
    console.log(`ℹ️ Blockchain sync completed - all nodes in sync`);
  }
}

// Blockchain sync function - sesuai prinsip blockchain
async function blockchainSync(blockchain, localChain, remoteChain) {
  const changes = { inserted: 0, conflicts: 0 };
  
  // Create map of existing blocks for fast lookup
  const existingBlocks = new Map();
  localChain.forEach(block => {
    existingBlocks.set(block.index, block.hash);
  });
  
  console.log(`📊 Local blocks: ${localChain.length}, Remote blocks: ${remoteChain.length}`);
  
  // Process remote blocks - hanya append yang missing
  for (const remoteBlock of remoteChain) {
    const existingHash = existingBlocks.get(remoteBlock.index);
    
    if (!existingHash) {
      // Block tidak ada di local - APPEND (sesuai prinsip blockchain)
      try {
        // Validate previous block exists (untuk block setelah genesis)
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
        
        // APPEND block baru (tidak ada delete!)
        blockchain.db.prepare('INSERT INTO block (idx, timestamp, data, previousHash, hash) VALUES (?, ?, ?, ?, ?)')
          .run(remoteBlock.index, remoteBlock.timestamp, remoteBlock.data, remoteBlock.previousHash, remoteBlock.hash);
        
        changes.inserted++;
        console.log(`✅ Appended block ${remoteBlock.index} from peer`);
      } catch (e) {
        console.warn(`⚠️ Failed to append block ${remoteBlock.index}:`, e.message);
      }
    } else if (existingHash !== remoteBlock.hash) {
      // Conflict detected - log tapi tidak overwrite (prinsip blockchain)
      changes.conflicts++;
      console.warn(`⚠️ Block ${remoteBlock.index} conflict detected (local: ${existingHash}, remote: ${remoteBlock.hash})`);
      console.warn(`ℹ️ Keeping local block (blockchain immutability principle)`);
    }
  }
  
  return changes;
}

export async function broadcastBlock(block) {
  console.log(`📡 Broadcasting block ${block.index} to ${peers.length} peers`);
  
  // Convert block untuk kompatibilitas dengan proto
  const protoBlock = {
    index: block.index,
    timestamp: block.timestamp,
    data: JSON.stringify(block.data), // Convert object ke string JSON
    hash: block.hash,
    previousHash: block.previousHash
  };
  
  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);
    
    // Cek apakah peer sudah punya block ini
    try {
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Timeout checking peer chain'));
        }, 2000);
        
        client.GetBlockchain({}, (err, response) => {
          clearTimeout(timeout);
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        });
      });
      
      const peerChainLength = response.chain.length;
      if (peerChainLength > block.index) {
        console.log(`⏭️ Skipping ${peer} - already has block ${block.index} (chain length: ${peerChainLength})`);
        continue;
      }
      
      // Cek apakah peer siap menerima block ini
      if (peerChainLength < block.index - 1) {
        console.log(`⏳ ${peer} chain too short (${peerChainLength}), skipping broadcast`);
        continue;
      }
      
      // Cek previousHash compatibility
      if (peerChainLength >= block.index - 1) {
        const peerLatestBlock = response.chain[peerChainLength - 1];
        if (peerLatestBlock && peerLatestBlock.hash !== block.previousHash) {
          console.log(`⚠️ ${peer} previousHash mismatch, skipping broadcast`);
          continue;
        }
      }
      
    } catch (e) {
      console.warn(`⚠️ Could not check ${peer} chain, proceeding with broadcast:`, e.message);
    }
    
    await new Promise((resolve) => {
      const timeout = setTimeout(() => {
        console.warn(`⏰ Timeout broadcast ke ${peer}`);
        resolve();
      }, 3000);

      client.ReceiveBlock(protoBlock, (err, response) => {
        clearTimeout(timeout);
        if (err) {
          console.warn(`❌ Failed to broadcast to ${peer}:`, err.message);
        } else {
          console.log(`✅ Block ${block.index} broadcasted to ${peer}`);
        }
        resolve();
      });
    });
    
    // Delay kecil untuk mengurangi race condition
    await new Promise(resolve => setTimeout(resolve, 100));
  }
}

function validateChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return false;
  
  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    
    // Validasi struktur block
    if (typeof block !== 'object' || 
        typeof block.index !== 'number' || 
        typeof block.hash !== 'string' || 
        typeof block.previousHash !== 'string' || 
        typeof block.data !== 'string' || // Data dari proto adalah string
        typeof block.timestamp !== 'string') {
      console.warn(`❌ Invalid block structure at index ${i}`);
      return false;
    }
    
    // Validasi index berurutan
    if (block.index !== i) {
      console.warn(`❌ Block index mismatch at ${i}: expected ${i}, got ${block.index}`);
      return false;
    }
    
    // Parse data untuk validasi hash
    let parsedData;
    try {
      parsedData = JSON.parse(block.data);
    } catch (e) {
      console.warn(`❌ Invalid JSON data at index ${i}`);
      return false;
    }
    
    // Validasi hash block
    const expectedHash = createHash('sha256')
      .update(block.index + block.timestamp + block.data + block.previousHash) // Gunakan data string asli
      .digest('hex');
    
    if (block.hash !== expectedHash) {
      console.warn(`❌ Invalid block hash at index ${i}`);
      console.warn(`Expected: ${expectedHash}`);
      console.warn(`Got: ${block.hash}`);
      return false;
    }
    
    // Validasi previousHash untuk block setelah genesis
    if (i > 0 && block.previousHash !== chain[i - 1].hash) {
      console.warn(`❌ Invalid previousHash at index ${i}`);
      return false;
    }
  }
  return true;
}
