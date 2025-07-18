import fs from 'fs';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load gRPC proto
const packageDefinition = protoLoader.loadSync(
  path.resolve(__dirname, 'proto', 'blockchain.proto'),
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true,
  }
);

const protoDescriptor = grpc.loadPackageDefinition(packageDefinition);
const BlockchainService = protoDescriptor.BlockchainService;

// TLS credentials
const caCert = fs.readFileSync(path.resolve(__dirname, 'key', 'ca.crt'));
const clientCert = fs.readFileSync(path.resolve(__dirname, 'key', 'client.crt'));
const clientKey = fs.readFileSync(path.resolve(__dirname, 'key', 'client.key'));

const credentials = grpc.credentials.createSsl(caCert, clientKey, clientCert);

// Peers to sync with
const peers = [
  '172.16.1.253:50051',
  '172.16.2.253:50051',
  '172.16.2.254:50051',
];

function syncFromPeer(peerAddress) {
  const client = new BlockchainService(peerAddress, credentials);

  client.GetLatestBlocks({}, (err, response) => {
    if (err) {
      console.error(`❌ Failed to sync from ${peerAddress}: ${err.message} (${new Date().toISOString()})`);
      return;
    }

    console.log(`✅ Synced from ${peerAddress}:`, response.blocks);
  });
}

// Sync to all peers
peers.forEach((peer) => syncFromPeer(peer));
