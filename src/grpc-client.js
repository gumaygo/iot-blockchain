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
    const blockToSend = { ...block, data: JSON.stringify(block.data) };
    let sent = false;
    for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
      await new Promise((resolve) => {
        client.ReceiveBlock(blockToSend, (err, response) => {
          if (err) {
            console.warn(`❌ Failed to send to ${peer} (attempt ${attempt}):`, err.message);
            if (attempt === 3) {
              console.error(`❌ Giving up on ${peer}`);
            }
          } else {
            console.log(`✅ Block sent to ${peer}, chain length: ${response.chain.length}`);
            sent = true;
          }
          resolve();
        });
      });
    }
  }
}
