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
  const localChain = await blockchain.getChain();
  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);

    await new Promise((resolve) => {
      client.GetBlockchain({}, async (err, response) => {
        if (err) {
          console.warn(`\u274c Failed to sync from ${peer}:`, err.message);
          return resolve();
        }

        const remoteChain = response.chain;
        console.log(`Peer ${peer} chain length: ${remoteChain.length}`);
        if (remoteChain.length > localChain.length) {
          // Overwrite LevelDB dengan chain dari peer
          for (let i = 0; i < remoteChain.length; i++) {
            await blockchain.db.put(`block_${i}`, remoteChain[i]);
          }
          await blockchain.db.put('last', remoteChain.length - 1);
          console.log(`\ud83d\udd04 Synced from ${peer} \u2705`);
        }
        resolve();
      });
    });
  }
}
