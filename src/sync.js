import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';

const packageDef = protoLoader.loadSync('./proto/blockchain.proto');
const grpcObj = grpc.loadPackageDefinition(packageDef);
const BlockchainService = grpcObj.blockchain.Blockchain;

const peers = JSON.parse(fs.readFileSync('./peers.json', 'utf-8'));
const credentials = grpc.credentials.createSsl(fs.readFileSync('./key/ca.crt'));

export function getPeers() {
  return peers;
}

export async function syncChain(localChain) {
  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);

    await new Promise((resolve) => {
      client.GetChain({}, (err, response) => {
        if (err) {
          console.warn(`❌ Failed to sync from ${peer}:`, err.message);
          return resolve();
        }

        const remoteChain = response.blocks;
        if (remoteChain.length > localChain.length) {
          fs.writeFileSync('./chain/chain.json', JSON.stringify(remoteChain, null, 2));
          console.log(`🔄 Synced from ${peer} ✅`);
        }
        resolve();
      });
    });
  }
}
