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
        if (remoteChain.length > localChain.length) {
          console.log(`🔍 Validating remote chain from ${peer}...`);
          const isValid = validateChain(remoteChain);
          console.log(`✅ Remote chain validation result: ${isValid}`);
          
          if (isValid) {
            try {
              // Clear existing blocks and insert new ones
              blockchain.db.prepare('DELETE FROM block').run();
              for (let i = 0; i < remoteChain.length; i++) {
                const block = remoteChain[i];
                blockchain.db.prepare('INSERT INTO block (idx, timestamp, data, previousHash, hash) VALUES (?, ?, ?, ?, ?)')
                  .run(block.index, block.timestamp, block.data, block.previousHash, block.hash); // Data sudah string JSON
              }
              console.log(`🔄 Synced from ${peer} ✅`);
              hasChanges = true;
            } catch (e) {
              console.error('❌ Error writing chain to DB:', e.message);
            }
          } else {
            console.warn('⚠️ Remote chain invalid, not syncing!');
          }
        } else if (remoteChain.length === localChain.length) {
          // Cek apakah ada divergence di chain yang sama panjang
          const localLatest = localChain[localChain.length - 1];
          const remoteLatest = remoteChain[remoteChain.length - 1];
          
          if (localLatest && remoteLatest && localLatest.hash !== remoteLatest.hash) {
            console.warn(`⚠️ Chain divergence detected at length ${localChain.length}`);
            console.warn(`Local latest hash: ${localLatest.hash}`);
            console.warn(`Remote latest hash: ${remoteLatest.hash}`);
            
            // Pilih chain yang lebih panjang atau lebih baru
            if (remoteLatest.timestamp > localLatest.timestamp) {
              console.log(`🔄 Choosing remote chain (newer timestamp)`);
              try {
                blockchain.db.prepare('DELETE FROM block').run();
                for (let i = 0; i < remoteChain.length; i++) {
                  const block = remoteChain[i];
                  blockchain.db.prepare('INSERT INTO block (idx, timestamp, data, previousHash, hash) VALUES (?, ?, ?, ?, ?)')
                    .run(block.index, block.timestamp, block.data, block.previousHash, block.hash);
                }
                console.log(`🔄 Chain repaired from ${peer} ✅`);
                hasChanges = true;
              } catch (e) {
                console.error('❌ Error repairing chain:', e.message);
              }
            }
          }
        }
        resolve();
      });
    });
    console.log(`🔚 Selesai mencoba sync ke peer: ${peer}`);
  }
  
  if (hasChanges) {
    console.log(`🔄 Chain sync completed with changes`);
  } else {
    console.log(`ℹ️ Chain sync completed - no changes needed`);
  }
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
