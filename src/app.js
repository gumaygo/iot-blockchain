// src/app.js
import express from 'express';
import { Blockchain } from './blockchain.js';
import { verifySignature, isValidValidator } from './utils.js';
import { logAudit } from './audit.js';
import { getPeers } from './sync.js';
import axios from 'axios';
import fs from 'fs';
import { broadcastBlock } from './grpc-client.js';
import { syncChain } from './sync.js';

// Setelah block berhasil ditambahkan...

const app = express();
app.use(express.json());

const blockchain = new Blockchain();

// Otomatis sync ke peer jika chain lokal hanya Genesis Block
(async () => {
  if (blockchain.chain.length === 1 && blockchain.chain[0].index === 0) {
    console.log('⏳ Chain lokal hanya Genesis Block, mencoba sync ke peer...');
    try {
      await syncChain(blockchain.chain);
      // Reload chain dari file setelah sync
      blockchain.chain = JSON.parse(fs.readFileSync('./chain/chain.json', 'utf-8'));
      if (blockchain.chain.length > 1) {
        console.log(`✅ Chain lokal setelah sync: ${blockchain.chain.length} block`);
      } else {
        console.log('⚠️ Sync gagal atau semua peer hanya punya Genesis Block.');
      }
    } catch (err) {
      console.error('❌ Error saat sync ke peer:', err.message);
    }
  }
})();

// Endpoint: Tambah data sensor
app.post('/add-sensor-data', async (req, res) => {
  const { sensor_id, value, timestamp, signature, public_key } = req.body;
  const rawData = `${sensor_id}|${value}|${timestamp}`;

  // Validasi timestamp format
  const delta = Math.abs(new Date(timestamp) - new Date());
  if (delta > 10_000) return res.status(400).json({ error: 'Timestamp mismatch' });

  // Verifikasi signature dan validator
  if (!isValidValidator(sensor_id, public_key)) return res.status(401).json({ error: 'Unauthorized validator' });
  if (!verifySignature(rawData, signature, public_key)) return res.status(401).json({ error: 'Invalid signature' });

  // Tambah block
  const block = blockchain.addBlock({ sensor_id, value, timestamp });
  logAudit(`\u2714\ufe0f Block accepted from ${sensor_id} | index: ${block.index}`);

  // Broadcast ke peer via gRPC saja
  await broadcastBlock(block);
  res.status(201).json({ message: 'Block added and broadcasted', block });
});

// Endpoint: Terima block dari peer
app.post('/receive-block', (req, res) => {
  const block = req.body;
  const latestBlock = blockchain.getLatestBlock();

  if (block.index === latestBlock.index + 1 && block.previousHash === latestBlock.hash) {
    blockchain.chain.push(block);
    fs.writeFileSync('./chain/chain.json', JSON.stringify(blockchain.chain, null, 2));
    logAudit(`🔁 Received block from peer | index: ${block.index}`);
    res.json({ message: 'Block synced from peer' });
  } else {
    res.status(400).json({ error: 'Invalid block sequence' });
  }
});

// Endpoint: Ambil seluruh chain
app.get('/chain', (req, res) => {
  res.json(blockchain.chain);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 REST API server running on port ${PORT}`);
});

export default app;
