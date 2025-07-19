import express from 'express';
import { Blockchain } from './blockchain.js';
import { syncChain, broadcastBlock } from './sync.js';
import { ChainPruning } from './chain-pruning.js';
import { signData, getPublicKey, verifySignature } from './utils.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config({ path: './config.env' });

const app = express();
app.use(express.json());

// Get configuration from environment
const NODE_ADDRESS = process.env.NODE_ADDRESS || '172.16.1.253:50051';
const NODE_PORT = process.env.NODE_PORT || 3000;
const BROADCAST_COOLDOWN = parseInt(process.env.BROADCAST_COOLDOWN) || 1000;
const SYNC_INTERVAL = parseInt(process.env.SYNC_INTERVAL) || 30000;

// Initialize blockchain
const blockchain = new Blockchain();

// Initialize blockchain asynchronously
async function initializeApp() {
  try {
    await blockchain.initialize();
    console.log('✅ Blockchain initialized successfully');
    
    // Initialize optimizations after blockchain
    await initializeOptimizations();
  } catch (error) {
    console.error('❌ Blockchain initialization failed:', error.message);
    process.exit(1);
  }
}

// Start initialization
initializeApp();

// Initialize optimizations
let consensusManager, peerDiscovery, chainValidator, chainPruning;

async function initializeOptimizations() {
  try {
    console.log('🚀 Initializing blockchain optimizations...');
    
    // Initialize consensus manager
    const { ConsensusManager } = await import('./consensus.js');
    consensusManager = new ConsensusManager();
    
    // Initialize peer discovery with node address
    const { PeerDiscovery } = await import('./peer-discovery.js');
    peerDiscovery = new PeerDiscovery(NODE_ADDRESS);
    
    // Set global for sync.js access
    global.peerDiscovery = peerDiscovery;
    
    // Initialize chain validator
    const { ChainValidator } = await import('./merkle-tree.js');
    chainValidator = new ChainValidator();
    
    // Initialize chain pruning
    const { ChainPruning } = await import('./chain-pruning.js');
    chainPruning = new ChainPruning(blockchain);
    
    console.log('🚀 Blockchain optimizations initialized');
  } catch (error) {
    console.error('❌ Failed to initialize optimizations:', error.message);
  }
}

// Rate limiting untuk broadcast
let lastBroadcastTime = 0;

// Sync lock untuk mencegah konflik
let isSyncing = false;
let syncTimeout = null;

// Clear sync lock after timeout
function clearSyncLock() {
  isSyncing = false;
  if (syncTimeout) {
    clearTimeout(syncTimeout);
    syncTimeout = null;
  }
}

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
    if (now - lastBroadcastTime < BROADCAST_COOLDOWN) {
      console.log(`⏳ Broadcast cooldown active, skipping broadcast for block ${newBlock.index}`);
    } else {
      // Broadcast block baru ke semua peers (langsung, tidak menunggu sync)
      try {
        console.log(`🔄 Starting broadcast for block ${newBlock.index}...`);
        lastBroadcastTime = now;
        
        // Broadcast dalam background agar tidak blocking
        setImmediate(async () => {
          try {
            await broadcastBlock(newBlock, blockchain);
            console.log(`✅ Broadcast completed for block ${newBlock.index}`);
          } catch (error) {
            console.warn('⚠️ Background broadcast failed:', error.message);
          }
        });
      } catch (error) {
        console.warn('⚠️ Broadcast setup failed:', error.message);
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

// Reset database endpoint
app.post('/reset-database', async (req, res) => {
  try {
    console.log('🔄 Reset database requested...');
    const success = await blockchain.resetDatabase();
    
    if (success) {
      console.log('✅ Database reset successful');
      res.json({ 
        success: true, 
        message: 'Database reset successful',
        genesisHash: blockchain.getLatestBlock().hash
      });
    } else {
      console.error('❌ Database reset failed');
      res.status(500).json({ 
        success: false, 
        message: 'Database reset failed' 
      });
    }
  } catch (error) {
    console.error('❌ Reset database error:', error.message);
    res.status(500).json({ 
      success: false, 
      message: error.message 
    });
  }
});

// Start REST API server
const PORT = process.env.PORT || 3000;
app.listen(NODE_PORT, () => {
  console.log(`🚀 REST API server running on port ${NODE_PORT}`);
});

// Import dan start gRPC server
import './grpc-server.js';
import { setBlockchain } from './grpc-server.js';

// Set blockchain instance for gRPC server
setBlockchain(blockchain);

// Sync bersamaan setiap 30 detik (detik 00 dan 30)
function scheduleSyncAtMinute() {
  const now = new Date();
  const seconds = now.getSeconds();
  const milliseconds = now.getMilliseconds();
  
  // Hitung waktu sampai sync berikutnya
  let delay;
  if (seconds < 30) {
    // Sync di detik 30
    delay = (30 - seconds) * 1000 - milliseconds;
  } else {
    // Sync di detik 00 (menit berikutnya)
    delay = (60 - seconds) * 1000 - milliseconds;
  }
  
  console.log(`⏰ Next sync scheduled in ${Math.round(delay/1000)} seconds`);
  
  setTimeout(() => {
    // Jalankan sync
    performScheduledSync();
    
    // Schedule sync berikutnya
    scheduleSyncAtMinute();
  }, delay);
}

// Fungsi sync terjadwal
async function performScheduledSync() {
  if (isSyncing) {
    console.log('⏳ Sync already in progress, skipping scheduled sync...');
    return;
  }
  
  try {
    isSyncing = true;
    console.log('🔄 Starting scheduled sync (every 30 seconds)...');
    
    // Set timeout for sync lock
    syncTimeout = setTimeout(() => {
      console.warn('⏰ Sync timeout, clearing lock');
      clearSyncLock();
    }, 5000); // 5 detik timeout
    
    await syncChain(blockchain);
    console.log('✅ Scheduled sync completed');
  } catch (error) {
    console.error('❌ Scheduled sync error:', error.message);
  } finally {
    clearSyncLock();
  }
}

// Mulai sync terjadwal
scheduleSyncAtMinute();

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