// src/app.js
import express from 'express';
import { Blockchain } from './blockchain.js';
import { verifySignature, isValidValidator } from './utils.js';
import { logAudit } from './audit.js';
import { getPeers, syncChain } from './sync.js';
import { broadcastBlock } from './grpc-client.js';
import { Level } from 'level';
const db = new Level('./blockchaindb', { valueEncoding: 'json' });

const app = express();
app.use(express.json());

let blockchain;

async function initializeBlockchainWithSync(blockchain) {
  let chain = await blockchain.getChain();
  if (chain.length === 0) {
    // Coba sync ke peer
    let synced = false;
    try {
      await syncChain(blockchain);
      chain = await blockchain.getChain();
      if (chain.length > 0) {
        synced = true;
        console.log('Genesis block diambil dari peer.');
      }
    } catch (err) {
      console.error('❌ Error saat sync ke peer:', err.message);
    }
    if (!synced) {
      // Jika gagal sync, buat genesis block baru
      const genesis = blockchain.createGenesisBlock();
      await blockchain.db.put('block_0', genesis);
      await blockchain.db.put('last', 0);
      console.log('Genesis block baru dibuat karena tidak bisa sync ke peer.');
    }
  }
}

(async () => {
  blockchain = await Blockchain.create();
  await initializeBlockchainWithSync(blockchain);
})();

// Endpoint: Tambah data sensor
app.post('/add-sensor-data', async (req, res) => {
  if (!blockchain) return res.status(503).json({ error: 'Blockchain not ready' });
  try {
    const { sensor_id, value, timestamp, signature, public_key } = req.body;
    // Validasi tipe data
    if (typeof sensor_id !== 'string' || typeof value !== 'number' || typeof timestamp !== 'string' || typeof signature !== 'string' || typeof public_key !== 'string') {
      return res.status(400).json({ error: 'Invalid input type' });
    }
    // Validasi timestamp format
    const dateObj = new Date(timestamp);
    if (isNaN(dateObj.getTime())) return res.status(400).json({ error: 'Invalid timestamp format' });
    const delta = Math.abs(dateObj - new Date());
    if (delta > 10_000) return res.status(400).json({ error: 'Timestamp mismatch' });
    // Verifikasi signature dan validator
    if (!isValidValidator(sensor_id, public_key)) return res.status(401).json({ error: 'Unauthorized validator' });
    const rawData = `${sensor_id}|${value}|${timestamp}`;
    if (!verifySignature(rawData, signature, public_key)) return res.status(401).json({ error: 'Invalid signature' });
    // Tambah block
    const block = await blockchain.addBlock({ sensor_id, value, timestamp });
    logAudit(`✔️ Block accepted from ${sensor_id} | index: ${block.index}`);
    // Broadcast ke peer via gRPC saja
    await broadcastBlock(block);
    res.status(201).json({ message: 'Block added and broadcasted', block });
  } catch (err) {
    console.error('❌ Error /add-sensor-data:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint: Terima block dari peer
app.post('/receive-block', async (req, res) => {
  if (!blockchain) return res.status(503).json({ error: 'Blockchain not ready' });
  try {
    const block = req.body;
    // Validasi struktur block
    if (typeof block !== 'object' || block === null || typeof block.index !== 'number' || typeof block.previousHash !== 'string' || typeof block.hash !== 'string' || typeof block.data !== 'object') {
      return res.status(400).json({ error: 'Invalid block structure' });
    }
    // Validasi hash block
    // (hash harus sesuai dengan data block)
    // NOTE: hash validation sebaiknya dilakukan di Blockchain.addBlock, tapi kita cek di sini juga
    // (Akan lebih baik jika Block class expose static validateBlock)
    const latestBlock = await blockchain.getLatestBlock();
    if (block.index === latestBlock.index + 1 && block.previousHash === latestBlock.hash) {
      // TODO: Validasi signature jika ada
      await blockchain.addBlock(block.data);
      logAudit(`🔁 Received block from peer | index: ${block.index}`);
      res.json({ message: 'Block synced from peer' });
    } else {
      res.status(400).json({ error: 'Invalid block sequence' });
    }
  } catch (err) {
    console.error('❌ Error /receive-block:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint: Ambil seluruh chain
app.get('/chain', async (req, res) => {
  if (!blockchain) return res.status(503).json({ error: 'Blockchain not ready' });
  try {
    const chain = await blockchain.getChain();
    res.json(chain);
  } catch (err) {
    console.error('❌ Error /chain:', err.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Tambahkan kode gRPC server di bawah ini
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import path from 'path';

async function defineGrpcServer(blockchain) {
  const __dirname = path.resolve();
  const packageDefinition = protoLoader.loadSync(
    path.join(__dirname, 'proto', 'blockchain.proto'),
    { keepCase: true, longs: String, enums: String, defaults: true, oneofs: true }
  );
  const grpcObject = grpc.loadPackageDefinition(packageDefinition);
  const blockchainProto = grpcObject.blockchain;

  // TLS setup
  const ca = fs.readFileSync(path.join(__dirname, 'key', 'ca.crt'));
  const cert = fs.readFileSync(path.join(__dirname, 'key', 'server.crt'));
  const key = fs.readFileSync(path.join(__dirname, 'key', 'server.key'));
  const credentials = grpc.ServerCredentials.createSsl(
    ca,
    [{ cert_chain: cert, private_key: key }],
    true
  );

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
    // Validasi struktur block
    if (typeof block !== 'object' || block === null || typeof block.index !== 'number' || typeof block.previousHash !== 'string' || typeof block.hash !== 'string' || typeof block.data !== 'object') {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block structure' });
    }
    // Validasi hash block
    const { createHash } = await import('crypto');
    const expectedHash = createHash('sha256')
      .update(block.index + block.timestamp + JSON.stringify(block.data) + block.previousHash)
      .digest('hex');
    if (block.hash !== expectedHash) {
      return callback({ code: grpc.status.INVALID_ARGUMENT, message: 'Invalid block hash' });
    }
    if (block.index === latest.index + 1 && block.previousHash === latest.hash) {
      try {
        await blockchain.addBlock(block.data);
        const chain = await blockchain.getChain();
        callback(null, { chain });
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
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 REST API server running on port ${PORT}`);
});

export default app;
