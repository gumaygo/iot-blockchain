// src/grpc-server.js
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import { Blockchain } from './blockchain.js';

const packageDef = protoLoader.loadSync('./proto/blockchain.proto');
const grpcObj = grpc.loadPackageDefinition(packageDef);
const blockchainPkg = grpcObj.blockchain;

const blockchain = new Blockchain();

function receiveBlock(call, callback) {
  const block = call.request;
  const last = blockchain.getLatestBlock();

  if (block.index === last.index + 1 && block.previousHash === last.hash) {
    blockchain.chain.push(block);
    fs.writeFileSync('./chain/chain.json', JSON.stringify(blockchain.chain, null, 2));
    console.log(`🔗 Received block via gRPC: index ${block.index}`);
  } else {
    console.log('⚠️ Rejected invalid block via gRPC');
  }

  callback(null, { blocks: blockchain.chain });
}

function getChain(_, callback) {
  callback(null, { blocks: blockchain.chain });
}

// TLS server with client certificate required (mTLS)
const server = new grpc.Server();

server.addService(blockchainPkg.Blockchain.service, {
  ReceiveBlock: receiveBlock,
  GetChain: getChain
});

const creds = grpc.ServerCredentials.createSsl(
  fs.readFileSync('./key/ca.crt'), // Trust store (CA certs)
  [{
    cert_chain: fs.readFileSync('./key/server.crt'),
    private_key: fs.readFileSync('./key/server.key')
  }],
  true // requireClientCertificate = true
);

server.bindAsync('0.0.0.0:50051', creds, () => {
  console.log('🔐 gRPC server with mTLS running on port 50051');
  server.start();
});
