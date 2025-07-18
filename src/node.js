// src/node.js
import express from 'express';
import { Blockchain } from './blockchain.js';
import { verifySignature, isValidValidator } from './utils.js';
import { logAudit } from './audit.js';
import { getPeers } from './sync.js';
import axios from 'axios';
import fs from 'fs';
import { broadcastBlock } from './grpc-client.js';

// Setelah block berhasil ditambahkan...

const app = express();
app.use(express.json());

const blockchain = new Blockchain();

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
  logAudit(`✔️ Block accepted from ${sensor_id} | index: ${block.index}`);

  // Broadcast ke peer
  const peers = getPeers();
  for (const peer of peers) {
    try {
      await axios.post(`${peer}/receive-block`, block);
    } catch (e) {
      console.warn(`⚠️ Failed to broadcast to ${peer}`);
    }
  }

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

export default app;
