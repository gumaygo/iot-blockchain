import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import path from 'path';
import { Blockchain } from './blockchain.js';

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

const blockchain = new Blockchain();

async function GetBlockchain(call, callback) {
  await blockchain.init();
  const chain = await blockchain.getChain();
  callback(null, { chain });
}

async function ReceiveBlock(call, callback) {
  const block = call.request;
  // Pastikan data block konsisten: jika string, parse ke object
  if (typeof block.data === 'string') {
    try {
      block.data = JSON.parse(block.data);
    } catch {}
  }
  await blockchain.init();
  const latest = await blockchain.getLatestBlock();
  if (block.index === latest.index + 1 && block.previousHash === latest.hash) {
    await blockchain.addBlock(block.data);
    const chain = await blockchain.getChain();
    callback(null, { chain });
  } else {
    callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block sequence' });
  }
}

const server = new grpc.Server();
server.addService(blockchainProto.Blockchain.service, {
  GetBlockchain: (call, callback) => { GetBlockchain(call, callback); },
  ReceiveBlock: (call, callback) => { ReceiveBlock(call, callback); }
});

server.bindAsync('0.0.0.0:50051', credentials, () => {
  console.log('✅ gRPC server running on port 50051');
  server.start();
});
