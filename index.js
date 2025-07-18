import fs from 'fs';
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import path from 'path';

const __dirname = path.resolve();

const packageDefinition = protoLoader.loadSync(
  path.join(__dirname, 'proto', 'blockchain.proto'),
  { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
);

const blockchainProto = grpc.loadPackageDefinition(packageDefinition).blockchain;

const peerAddresses = JSON.parse(fs.readFileSync('peers.json', 'utf-8'));

// TLS credentials
import tls from 'tls';
import { readFileSync } from 'fs';
const ca = readFileSync('key/ca.crt');
const cert = readFileSync('key/client.crt');
const key = readFileSync('key/client.key');

const credentials = grpc.credentials.createSsl(ca, key, cert);

function syncFromPeer(peerAddress) {
  const client = new blockchainProto.Blockchain(peerAddress, credentials);
  client.getBlockchain({}, (err, response) => {
    if (err) {
      console.error(`❌ Failed to sync from ${peerAddress}: ${err.message}`);
    } else {
      console.log(`✅ Synced from ${peerAddress}. Length: ${response.chain.length}`);
    }
  });
}

peerAddresses.forEach(syncFromPeer);
