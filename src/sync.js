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
        // Validasi chain dari peer
        if (remoteChain.length > localChain.length && validateChain(remoteChain)) {
          try {
            for (let i = 0; i < remoteChain.length; i++) {
              await blockchain.db.put(`block_${i}`, remoteChain[i]);
            }
            await blockchain.db.put('last', remoteChain.length - 1);
            console.log(`🔄 Synced from ${peer} ✅`);
          } catch (e) {
            console.error('❌ Error writing chain to DB:', e.message);
          }
        } else if (remoteChain.length > localChain.length) {
          console.warn('⚠️ Remote chain invalid, not syncing!');
        }
        resolve();
      });
    });
    console.log(`🔚 Selesai mencoba sync ke peer: ${peer}`);
  }
}

function validateChain(chain) {
  if (!Array.isArray(chain) || chain.length === 0) return false;
  for (let i = 0; i < chain.length; i++) {
    const block = chain[i];
    if (typeof block !== 'object' || typeof block.index !== 'number' || typeof block.hash !== 'string' || typeof block.previousHash !== 'string' || typeof block.data !== 'object') {
      return false;
    }
    // Validasi hash block
    const { createHash } = require('crypto');
    const expectedHash = createHash('sha256')
      .update(block.index + block.timestamp + JSON.stringify(block.data) + block.previousHash)
      .digest('hex');
    if (block.hash !== expectedHash) return false;
    if (i > 0 && block.previousHash !== chain[i - 1].hash) return false;
  }
  return true;
}
