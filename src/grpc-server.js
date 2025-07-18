import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import path from 'path';

const __dirname = path.resolve();

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
// Ganti 'blockchain' sesuai nama package di proto!
const blockchainProto = grpcObject.blockchain;

// TLS
const ca = fs.readFileSync(path.join(__dirname, 'key', 'ca.crt'));
const cert = fs.readFileSync(path.join(__dirname, 'key', 'server.crt'));
const key = fs.readFileSync(path.join(__dirname, 'key', 'server.key'));
const credentials = grpc.ServerCredentials.createSsl(
  ca,
  [{
    cert_chain: cert,
    private_key: key
  }],
  true
);

// Data blockchain local (dummy)
let blockchain = [
  { index: 0, timestamp: new Date().toISOString(), data: "Genesis Block", hash: "hash0", previousHash: "0" }
];

// Ganti method berikut agar sesuai proto kamu!
function GetBlockchain(call, callback) {
  callback(null, { chain: blockchain });
}

// Ganti 'Blockchain' sesuai service di proto!
const server = new grpc.Server();
server.addService(blockchainProto.Blockchain.service, {
  GetBlockchain
  // tambahkan method lain jika ada
});

server.bindAsync('0.0.0.0:50051', credentials, () => {
  console.log('✅ gRPC server running on port 50051');
  server.start();
});
