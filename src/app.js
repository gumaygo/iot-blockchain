import express from 'express';
import { Blockchain } from './blockchain.js';
import { syncChain, broadcastBlock, initializeOptimizations } from './sync.js';
import { ChainPruning } from './chain-pruning.js';
import { signData, getPublicKey, verifySignature } from './utils.js';

const app = express();
app.use(express.json());

// Inisialisasi blockchain
const blockchain = await Blockchain.create();

// Initialize optimizations
initializeOptimizations(blockchain);

// Initialize chain pruning
const chainPruning = new ChainPruning(blockchain);

// Rate limiting untuk broadcast
let lastBroadcastTime = 0;
const BROADCAST_COOLDOWN = 2000; // 2 detik cooldown

// Sync lock untuk mencegah konflik
let isSyncing = false;

// REST API Routes
app.get('/blockchain', async (req, res) => {
  try {
    const chain = blockchain.getChain();
    console.log(`⛓️  Panjang block lokal: ${chain.length}`);
    res.json({ chain, length: chain.length });
  } catch (error) {
    console.error('❌ Error getting blockchain:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/add-sensor-data', async (req, res) => {
  try {
    const { sensor_id, value, timestamp, signature, public_key } = req.body;
    
    // Validasi input
    if (!sensor_id || typeof value !== 'number' || !timestamp || !signature || !public_key) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Verifikasi signature
    const rawData = `${sensor_id}|${value}|${timestamp}`;
    if (!verifySignature(rawData, signature, public_key)) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    console.log(`📝 Adding new sensor data: ${sensor_id} = ${value}`);
    
    // Tambah block ke blockchain
    const newBlock = blockchain.addBlock({ sensor_id, value, timestamp });
    console.log(`✅ Block baru ditambahkan: ${newBlock.index}`);

    // Rate limiting untuk broadcast dengan sync lock
    const now = Date.now();
    if (now - lastBroadcastTime < BROADCAST_COOLDOWN || isSyncing) {
      console.log(`⏳ Broadcast cooldown/sync active, skipping broadcast for block ${newBlock.index}`);
    } else {
      // Broadcast block baru ke semua peers
      try {
        console.log(`🔄 Starting broadcast for block ${newBlock.index}...`);
        lastBroadcastTime = now;
        await broadcastBlock(newBlock, blockchain);
        console.log(`✅ Broadcast completed for block ${newBlock.index}`);
      } catch (error) {
        console.warn('⚠️ Broadcast failed:', error.message);
      }
    }

    res.json({ 
      message: 'Block added successfully', 
      block: newBlock,
      chainLength: blockchain.getChain().length 
    });
  } catch (error) {
    console.error('❌ Error adding block:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Sync blockchain dengan peers
app.post('/sync', async (req, res) => {
  try {
    const chainBefore = blockchain.getChain();
    console.log(`⛓️  Panjang block lokal sebelum sync: ${chainBefore.length}`);
    
    await syncChain(blockchain);
    
    const chainAfter = blockchain.getChain();
    console.log(`🔄 Sync selesai. Panjang block setelah sync: ${chainAfter.length}`);
    
    res.json({ 
      message: 'Sync completed',
      beforeLength: chainBefore.length,
      afterLength: chainAfter.length
    });
  } catch (error) {
    console.error('❌ Error during sync:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// New API endpoints for optimizations
app.get('/peers/status', async (req, res) => {
  try {
    const { getPeers } = await import('./sync.js');
    const peers = getPeers();
    res.json({ 
      peers,
      count: peers.length,
      message: 'Peer status retrieved'
    });
  } catch (error) {
    console.error('❌ Error getting peer status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/consensus/status', (req, res) => {
  try {
    const chain = blockchain.getChain();
    res.json({ 
      chainLength: chain.length,
      merkleRoot: chain.length > 0 ? 'calculated' : 'none',
      consensus: 'active',
      message: 'Consensus status retrieved'
    });
  } catch (error) {
    console.error('❌ Error getting consensus status:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Chain pruning endpoints
app.post('/prune/chain', async (req, res) => {
  try {
    await chainPruning.pruneChain();
    const stats = chainPruning.getArchiveStats();
    res.json({ 
      message: 'Chain pruning completed',
      stats
    });
  } catch (error) {
    console.error('❌ Error during chain pruning:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/prune/stats', (req, res) => {
  try {
    const stats = chainPruning.getArchiveStats();
    res.json({ 
      stats,
      message: 'Archive statistics retrieved'
    });
  } catch (error) {
    console.error('❌ Error getting archive stats:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/prune/restore', async (req, res) => {
  try {
    await chainPruning.restoreArchivedBlocks();
    res.json({ 
      message: 'Archived blocks restored'
    });
  } catch (error) {
    console.error('❌ Error restoring archived blocks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.post('/prune/compact', async (req, res) => {
  try {
    const { maxAge } = req.body;
    chainPruning.compactArchive(maxAge);
    res.json({ 
      message: 'Archive compacted'
    });
  } catch (error) {
    console.error('❌ Error compacting archive:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/prune/block/:index', (req, res) => {
  try {
    const index = parseInt(req.params.index);
    const block = chainPruning.getArchivedBlock(index);
    if (block) {
      res.json({ block });
    } else {
      res.status(404).json({ error: 'Block not found in archive' });
    }
  } catch (error) {
    console.error('❌ Error getting archived block:', error.message);
    res.status(500).json({ error: error.message });
  }
});

app.get('/prune/search', (req, res) => {
  try {
    const { query } = req.query;
    if (!query) {
      return res.status(400).json({ error: 'Query parameter required' });
    }
    const blocks = chainPruning.searchArchivedBlocks(query);
    res.json({ 
      blocks,
      count: blocks.length,
      query
    });
  } catch (error) {
    console.error('❌ Error searching archived blocks:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// Start REST API server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 REST API server running on port ${PORT}`);
});

// Import dan start gRPC server
import './grpc-server.js';

// Auto sync setiap 30 detik dengan sync lock
setInterval(async () => {
  if (isSyncing) {
    console.log('⏳ Sync already in progress, skipping...');
    return;
  }
  
  try {
    isSyncing = true;
    console.log('🔄 Starting auto sync...');
    await syncChain(blockchain);
    console.log('✅ Auto sync completed');
  } catch (error) {
    console.error('❌ Auto sync error:', error.message);
  } finally {
    isSyncing = false;
  }
}, 30000);

// Auto chain pruning setiap 6 jam
setInterval(async () => {
  try {
    console.log('🗑️ Checking for chain pruning...');
    await chainPruning.pruneChain();
  } catch (error) {
    console.error('❌ Auto pruning error:', error.message);
  }
}, 6 * 60 * 60 * 1000);

console.log('✅ Aplikasi blockchain IoT berhasil dimulai dengan optimizations dan pruning!'); 