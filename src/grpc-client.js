// src/grpc-client.js
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import { getPeers } from './sync.js';

const packageDefinition = protoLoader.loadSync('./proto/blockchain.proto', {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const grpcObject = grpc.loadPackageDefinition(packageDefinition);
const BlockchainService = grpcObject.blockchain.Blockchain;

// Load trusted certificate authority (gabungan semua .crt dari node lain)
const rootCert = fs.readFileSync('./key/ca.crt'); // hasil gabungan node1.crt + node2.crt + ...

const credentials = grpc.credentials.createSsl(rootCert);

/**
 * Broadcast block ke semua node di peers.json via gRPC
 * @param {Object} block - block yang ingin dikirim
 */
export async function broadcastBlock(block) {
  const peers = getPeers();

  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);

    await new Promise((resolve) => {
      client.ReceiveBlock(block, (err, response) => {
        if (err) {
          console.warn(`❌ Failed to send to ${peer}:`, err.message);
        } else {
          console.log(`✅ Sent to ${peer} | Chain length: ${response.blocks.length}`);
        }
        resolve();
      });
    });
  }
}
