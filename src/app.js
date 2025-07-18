// src/app.js
import express from 'express';
import { Blockchain } from './blockchain.js';
import { verifySignature, isValidValidator } from './utils.js';
import { logAudit } from './audit.js';
import { getPeers, syncChain } from './sync.js';
import axios from 'axios';
import fs from 'fs';
import { broadcastBlock } from './grpc-client.js';

const app = express();
app.use(express.json());

const blockchain = new Blockchain();

// Otomatis sync ke peer jika chain lokal hanya Genesis Block
(async () => {
  await blockchain.init();
  const chain = await blockchain.getChain();
  if (chain.length === 1 && chain[0].index === 0) {
    console.log('⏳ Chain lokal hanya Genesis Block, mencoba sync ke peer...');
    try {
      await syncChain(chain);
      // Reload chain dari DB setelah sync
      const newChain = await blockchain.getChain();
      if (newChain.length > 1) {
        console.log(`✅ Chain lokal setelah sync: ${newChain.length} block`);
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
  const block = await blockchain.addBlock({ sensor_id, value, timestamp });
  logAudit(`✔️ Block accepted from ${sensor_id} | index: ${block.index}`);

  // Broadcast ke peer via gRPC saja
  await broadcastBlock(block);
  res.status(201).json({ message: 'Block added and broadcasted', block });
});

// Endpoint: Terima block dari peer
app.post('/receive-block', async (req, res) => {
  const block = req.body;
  const latestBlock = await blockchain.getLatestBlock();

  if (block.index === latestBlock.index + 1 && block.previousHash === latestBlock.hash) {
    await blockchain.addBlock(block.data);
    logAudit(`🔁 Received block from peer | index: ${block.index}`);
    res.json({ message: 'Block synced from peer' });
  } else {
    res.status(400).json({ error: 'Invalid block sequence' });
  }
});

// Endpoint: Ambil seluruh chain
app.get('/chain', async (req, res) => {
  const chain = await blockchain.getChain();
  res.json(chain);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 REST API server running on port ${PORT}`);
});

export default app;
