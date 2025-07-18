// src/grpc-client.js
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import { getPeers } from './sync.js';

const packageDef = protoLoader.loadSync('./proto/blockchain.proto');
const grpcObj = grpc.loadPackageDefinition(packageDef);
const BlockchainService = grpcObj.blockchain.Blockchain;

const credentials = grpc.credentials.createSsl(
  fs.readFileSync('./key/ca.crt') // Sertifikat CA (optional sekarang, wajib di mTLS nanti)
);

/**
 * Kirim block ke semua peer (via gRPC ReceiveBlock)
 */
export async function broadcastBlock(block) {
  const peers = getPeers();

  for (const peer of peers) {
    const client = new BlockchainService(
      peer, // misalnya "192.168.18.30:50051"
      credentials
    );

    await new Promise((resolve) => {
      client.ReceiveBlock(block, (err, response) => {
        if (err) {
          console.warn(`❌ Failed send to ${peer}:`, err.message);
        } else {
          console.log(`✅ Block sent to ${peer} (chain length: ${response.blocks.length})`);
        }
        resolve();
      });
    });
  }
}
