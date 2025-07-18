import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import path from 'path';

const __dirname = path.resolve();

// Load peers from JSON
const peerAddresses = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'peers.json'), 'utf-8')
);

// Load proto
const packageDefinition = protoLoader.loadSync(
  path.join(__dirname, 'proto', 'blockchain.proto'),
  {
    keepCase: true,
    longs: String,
    enums: String,
    defaults: true,
    oneofs: true
  }
);
const grpcObject = grpc.loadPackageDefinition(packageDefinition);
// Ganti 'blockchain' sesuai nama package di blockchain.proto!
const blockchainProto = grpcObject.blockchain;

// TLS credentials
const ca = fs.readFileSync(path.join(__dirname, 'key', 'ca.crt'));
const cert = fs.readFileSync(path.join(__dirname, 'key', 'client.crt'));
const key = fs.readFileSync(path.join(__dirname, 'key', 'client.key'));
const credentials = grpc.credentials.createSsl(ca, key, cert);

function syncFromPeer(peerAddress) {
  // Ganti 'Blockchain' sesuai nama service di proto!
  const client = new blockchainProto.Blockchain(
    peerAddress,
    credentials
  );
  // Ganti 'GetBlockchain' sesuai nama RPC di proto!
  client.GetBlockchain({}, (err, response) => {
    if (err) {
      console.error(`❌ Failed to sync from ${peerAddress}: ${err.message}`);
    } else {
      console.log(`✅ Synced from ${peerAddress}. Chain:`, response.chain?.length || 0);
    }
  });
}

peerAddresses.forEach(syncFromPeer);
