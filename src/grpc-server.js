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

// Data blockchain local (load dari file)
function loadChain() {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, 'chain', 'chain.json'), 'utf-8'));
  } catch {
    return [{ index: 0, timestamp: new Date().toISOString(), data: "Genesis Block", hash: "hash0", previousHash: "0" }];
  }
}

function saveChain(chain) {
  fs.writeFileSync(path.join(__dirname, 'chain', 'chain.json'), JSON.stringify(chain, null, 2));
}

// Ganti method berikut agar sesuai proto kamu!
function GetBlockchain(call, callback) {
  const chain = loadChain();
  callback(null, { chain });
}

function ReceiveBlock(call, callback) {
  const block = call.request;
  let chain = loadChain();
  const latest = chain[chain.length - 1];
  if (block.index === latest.index + 1 && block.previousHash === latest.hash) {
    chain.push(block);
    saveChain(chain);
    callback(null, { chain });
  } else {
    callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block sequence' });
  }
}

// Ganti 'Blockchain' sesuai service di proto!
const server = new grpc.Server();
server.addService(blockchainProto.Blockchain.service, {
  GetBlockchain,
  ReceiveBlock
  // tambahkan method lain jika ada
});

server.bindAsync('0.0.0.0:50051', credentials, () => {
  console.log('✅ gRPC server running on port 50051');
  server.start();
});
