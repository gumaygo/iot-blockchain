import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import path from 'path';
import { Blockchain } from './blockchain.js';
import { createHash } from 'crypto';

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

const blockchain = await Blockchain.create();

function convertChainToProto(chain) {
  return chain.map(block => ({
    index: block.index,
    timestamp: block.timestamp,
    data: JSON.stringify(block.data), // Convert object ke string JSON
    hash: block.hash,
    previousHash: block.previousHash
  }));
}

async function GetBlockchain(call, callback) {
  await blockchain.init();
  const chain = blockchain.getChain();
  const protoChain = convertChainToProto(chain);
  callback(null, { chain: protoChain });
}

async function ReceiveBlock(call, callback) {
  const block = call.request;
  
  // Parse data dari string JSON ke object
  let parsedData;
  try {
    parsedData = JSON.parse(block.data);
  } catch (e) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid JSON data' });
  }
  
  await blockchain.init();
  const latest = blockchain.getLatestBlock();
  
  // Validasi struktur block
  if (typeof block !== 'object' || block === null || typeof block.index !== 'number' || typeof block.previousHash !== 'string' || typeof block.hash !== 'string' || typeof block.data !== 'string') {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block structure' });
  }
  
  // Validasi hash block
  const expectedHash = createHash('sha256')
    .update(block.index + block.timestamp + block.data + block.previousHash) // Gunakan data string asli
    .digest('hex');
  if (block.hash !== expectedHash) {
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block hash' });
  }
  
  if (block.index === latest.index + 1 && block.previousHash === latest.hash) {
    try {
      blockchain.addBlock(parsedData); // Gunakan data yang sudah di-parse
      const chain = blockchain.getChain();
      const protoChain = convertChainToProto(chain);
      
      callback(null, { chain: protoChain });
    } catch (e) {
      callback({ code: grpc.status.INTERNAL, message: e.message });
    }
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
