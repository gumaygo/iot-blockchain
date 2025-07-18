// src/grpc-client.js
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import { getPeers } from './sync.js';

// Load proto
const packageDefinition = protoLoader.loadSync('./proto/blockchain.proto', {
  keepCase: true,
  longs: String,
  enums: String,
  defaults: true,
  oneofs: true
});

const grpcObject = grpc.loadPackageDefinition(packageDefinition);
const BlockchainService = grpcObject.blockchain.Blockchain;

// Load mutual TLS credentials
const caCert = fs.readFileSync('./key/ca.crt');
const clientKey = fs.readFileSync('./key/client.key');
const clientCert = fs.readFileSync('./key/client.crt');

const credentials = grpc.credentials.createSsl(caCert, clientKey, clientCert);

/**
 * Kirim block ke semua peer menggunakan gRPC dengan mTLS
 */
export async function broadcastBlock(block) {
  const peers = getPeers();

  for (const peer of peers) {
    const client = new BlockchainService(peer, credentials);

    // Kirim block dengan data di-stringify
    const blockToSend = { ...block, data: JSON.stringify(block.data) };
    await new Promise((resolve) => {
      client.ReceiveBlock(blockToSend, (err, response) => {
        if (err) {
          console.warn(`\u274c Failed to send to ${peer}:`, err.message);
        } else {
          console.log(`\u2705 Block sent to ${peer}, chain length: ${response.chain.length}`);
        }
        resolve();
      });
    });
  }
}
