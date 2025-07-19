import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import { Blockchain } from './blockchain.js';
import fs from 'fs';

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
            } catch (e) {
              console.error('❌ Error writing chain to DB:', e.message);
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
    const { createHash } = require('crypto');
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
