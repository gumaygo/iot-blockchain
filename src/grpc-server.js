import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import path from 'path';
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

// Temporarily disable TLS for testing
// const ca = fs.readFileSync(path.join(__dirname, 'key', 'ca.crt'));
// const cert = fs.readFileSync(path.join(__dirname, 'key', 'server.crt'));
// const key = fs.readFileSync(path.join(__dirname, 'key', 'server.key'));
// const credentials = grpc.ServerCredentials.createSsl(
//   ca,
//   [{
//     cert_chain: cert,
//     private_key: key
//   }],
//   true
// );

// Use insecure connection for testing
const credentials = grpc.ServerCredentials.createInsecure();

// Client credentials for peer communication (insecure for testing)
export const clientCredentials = grpc.credentials.createInsecure();

// Server credentials with proper hostname
const serverCredentials = grpc.ServerCredentials.createInsecure();

// Blockchain instance will be set by app.js
let blockchain = null;

export function setBlockchain(blockchainInstance) {
  blockchain = blockchainInstance;
}

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
  const chain = blockchain.getChain();
  const protoChain = convertChainToProto(chain);
  callback(null, { chain: protoChain });
}

async function ReceiveBlock(call, callback) {
  const block = call.request;
  
  console.log(`📥 Received block ${block.index} from peer`);
  
  // Parse data dari string JSON ke object
  let parsedData;
  try {
    parsedData = JSON.parse(block.data);
  } catch (e) {
    console.warn(`❌ Invalid JSON data in block ${block.index}:`, e.message);
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid JSON data' });
  }
  
  const latest = blockchain.getLatestBlock();
  
  console.log(`📊 Local latest block: ${latest.index}, received block: ${block.index}`);
  console.log(`🔗 Latest hash: ${latest.hash}, received previousHash: ${block.previousHash}`);
  
  // Validasi struktur block
  if (typeof block !== 'object' || block === null || typeof block.index !== 'number' || typeof block.previousHash !== 'string' || typeof block.hash !== 'string' || typeof block.data !== 'string') {
    console.warn(`❌ Invalid block structure for block ${block.index}`);
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block structure' });
  }
  
  // Validasi hash block
  const expectedHash = createHash('sha256')
    .update(block.index + block.timestamp + block.data + block.previousHash) // Gunakan data string asli
    .digest('hex');
  if (block.hash !== expectedHash) {
    console.warn(`❌ Invalid block hash for block ${block.index}`);
    console.warn(`Expected: ${expectedHash}`);
    console.warn(`Got: ${block.hash}`);
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block hash' });
  }
  
  // Cek apakah block sudah ada
  try {
    const existingBlock = blockchain.db.prepare('SELECT * FROM blocks WHERE idx = ?').get(block.index);
    if (existingBlock) {
      console.log(`ℹ️ Block ${block.index} already exists, skipping...`);
      const chain = blockchain.getChain();
      const protoChain = convertChainToProto(chain);
      return callback(null, { chain: protoChain });
    }
  } catch (e) {
    // Block tidak ada, lanjutkan
  }
  
  // Validasi sequence - lebih fleksibel untuk chain divergence
  if (block.index > latest.index + 2) {
    console.warn(`❌ Block ${block.index} is too far ahead (latest: ${latest.index})`);
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Block too far ahead' });
  }
  
  // Jika previousHash tidak match, coba sync dulu
  if (block.previousHash !== latest.hash) {
    console.warn(`⚠️ PreviousHash mismatch for block ${block.index}, attempting sync...`);
    
    // Coba sync dengan peers untuk mendapatkan chain yang benar
    try {
      const { syncChain } = await import('./sync.js');
      await syncChain(blockchain);
      
      // Cek lagi setelah sync
      const newLatest = blockchain.getLatestBlock();
      if (block.previousHash !== newLatest.hash) {
        console.warn(`❌ PreviousHash still mismatch after sync for block ${block.index}`);
        return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid previousHash after sync' });
      }
      
      console.log(`✅ PreviousHash match after sync for block ${block.index}`);
    } catch (e) {
      console.warn(`❌ Sync failed during previousHash validation:`, e.message);
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid previousHash' });
    }
  }
  
  try {
    blockchain.addBlock(parsedData); // Gunakan data yang sudah di-parse
    const chain = blockchain.getChain();
    const protoChain = convertChainToProto(chain);
    
    console.log(`✅ Block ${block.index} added successfully`);
    callback(null, { chain: protoChain });
  } catch (e) {
    console.error(`❌ Error adding block ${block.index}:`, e.message);
    callback({ code: grpc.status.INTERNAL, message: e.message });
  }
}

async function AddBlock(call, callback) {
  const block = call.request;
  
  console.log(`📥 AddBlock called for block ${block.index} from peer`);
  
  // Parse data dari string JSON ke object
  let parsedData;
  try {
    parsedData = JSON.parse(block.data);
  } catch (e) {
    console.warn(`❌ Invalid JSON data in block ${block.index}:`, e.message);
    return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid JSON data' });
  }
  
  try {
    // Cek apakah block sudah ada
    const existingBlock = blockchain.db.prepare('SELECT * FROM blocks WHERE idx = ?').get(block.index);
    if (existingBlock) {
      console.log(`ℹ️ Block ${block.index} already exists, skipping...`);
      const chain = blockchain.getChain();
      const protoChain = convertChainToProto(chain);
      return callback(null, { chain: protoChain });
    }
    
    // Add block
    blockchain.addBlock(parsedData);
    const chain = blockchain.getChain();
    const protoChain = convertChainToProto(chain);
    
    console.log(`✅ Block ${block.index} added successfully via AddBlock`);
    callback(null, { chain: protoChain });
  } catch (e) {
    console.error(`❌ Error adding block ${block.index}:`, e.message);
    callback({ code: grpc.status.INTERNAL, message: e.message });
  }
}

const server = new grpc.Server();
server.addService(blockchainProto.Blockchain.service, {
  GetBlockchain: (call, callback) => { GetBlockchain(call, callback); },
  ReceiveBlock: (call, callback) => { ReceiveBlock(call, callback); },
  AddBlock: (call, callback) => { AddBlock(call, callback); }
});

server.bindAsync('0.0.0.0:50051', serverCredentials, () => {
  console.log('✅ gRPC server running on port 50051');
  server.start();
});
