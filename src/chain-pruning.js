// src/chain-pruning.js - Chain Pruning untuk optimize storage
import Database from 'better-sqlite3';
import { createHash } from 'crypto';

export class ChainPruning {
  constructor(blockchain) {
    this.blockchain = blockchain;
    this.pruningThreshold = 1000; // Archive blocks older than 1000
    this.archiveInterval = 24 * 60 * 60 * 1000; // 24 jam
    this.lastPruningTime = 0;
  }

  // Check if pruning is needed
  shouldPrune() {
    const now = Date.now();
    const chainLength = this.blockchain.getChain().length;
    
    return chainLength > this.pruningThreshold && 
           (now - this.lastPruningTime) > this.archiveInterval;
  }

  // Prune old blocks
  async pruneChain() {
    if (!this.shouldPrune()) {
      console.log('ℹ️ Chain pruning not needed');
      return;
    }

    console.log('🗑️ Starting chain pruning...');
    
    try {
      const chain = this.blockchain.getChain();
      const pruneIndex = Math.floor(chain.length * 0.8); // Keep 20% latest blocks
      
      if (pruneIndex < 100) {
        console.log('ℹ️ Chain too short for pruning');
        return;
      }

      // Create archive table if not exists
      this.createArchiveTable();
      
      // Archive old blocks
      const archivedBlocks = await this.archiveBlocks(pruneIndex);
      
      // Remove archived blocks from main table
      this.blockchain.db.prepare('DELETE FROM blocks WHERE idx < ?').run(pruneIndex);
      
      // Update genesis block to point to first remaining block
      const firstRemainingBlock = this.blockchain.db.prepare('SELECT * FROM blocks WHERE idx = ?').get(pruneIndex);
      if (firstRemainingBlock) {
        this.blockchain.db.prepare('UPDATE block SET previousHash = ? WHERE idx = 0').run(firstRemainingBlock.hash);
      }
      
      this.lastPruningTime = Date.now();
      
      console.log(`✅ Chain pruning completed: ${archivedBlocks} blocks archived`);
      
    } catch (error) {
      console.error('❌ Error during chain pruning:', error.message);
    }
  }

  // Create archive table
  createArchiveTable() {
    this.blockchain.db.prepare(`CREATE TABLE IF NOT EXISTS block_archive (
      idx INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL,
      previousHash TEXT NOT NULL,
      hash TEXT NOT NULL,
      archived_at TEXT NOT NULL
    )`).run();
  }

  // Archive blocks
  async archiveBlocks(upToIndex) {
    const blocks = this.blockchain.db.prepare('SELECT * FROM blocks WHERE idx < ? ORDER BY idx ASC').all(upToIndex);
    
    let archivedCount = 0;
    const archiveTime = new Date().toISOString();
    
    for (const block of blocks) {
      try {
        this.blockchain.db.prepare(`
          INSERT INTO block_archive (idx, timestamp, data, previousHash, hash, archived_at) 
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(block.idx, block.timestamp, block.data, block.previousHash, block.hash, archiveTime);
        
        archivedCount++;
      } catch (e) {
        console.warn(`⚠️ Failed to archive block ${block.idx}:`, e.message);
      }
    }
    
    return archivedCount;
  }

  // Restore archived blocks
  async restoreArchivedBlocks() {
    console.log('🔄 Restoring archived blocks...');
    
    try {
      const archivedBlocks = this.blockchain.db.prepare('SELECT * FROM block_archive ORDER BY idx ASC').all();
      
      for (const block of archivedBlocks) {
        try {
          // Check if block already exists
          const existing = this.blockchain.db.prepare('SELECT * FROM blocks WHERE idx = ?').get(block.idx);
          if (!existing) {
            this.blockchain.db.prepare(`
              INSERT INTO block (idx, timestamp, data, previousHash, hash) 
              VALUES (?, ?, ?, ?, ?)
            `).run(block.idx, block.timestamp, block.data, block.previousHash, block.hash);
          }
        } catch (e) {
          console.warn(`⚠️ Failed to restore block ${block.idx}:`, e.message);
        }
      }
      
      console.log(`✅ Restored ${archivedBlocks.length} archived blocks`);
      
    } catch (error) {
      console.error('❌ Error restoring archived blocks:', error.message);
    }
  }

  // Get archive statistics
  getArchiveStats() {
    try {
      const totalArchived = this.blockchain.db.prepare('SELECT COUNT(*) as count FROM block_archive').get();
      const totalActive = this.blockchain.db.prepare('SELECT COUNT(*) as count FROM blocks').get();
      const archiveSize = this.blockchain.db.prepare('SELECT SUM(LENGTH(data)) as size FROM block_archive').get();
      const activeSize = this.blockchain.db.prepare('SELECT SUM(LENGTH(data)) as size FROM blocks').get();
      
      return {
        archivedBlocks: totalArchived.count,
        activeBlocks: totalActive.count,
        archivedSize: archiveSize.size || 0,
        activeSize: activeSize.size || 0,
        lastPruning: this.lastPruningTime
      };
    } catch (error) {
      console.error('❌ Error getting archive stats:', error.message);
      return null;
    }
  }

  // Compact archive (remove old archives)
  compactArchive(maxAge = 30 * 24 * 60 * 60 * 1000) { // 30 days
    console.log('🗜️ Compacting archive...');
    
    try {
      const cutoffTime = new Date(Date.now() - maxAge).toISOString();
      const deleted = this.blockchain.db.prepare('DELETE FROM block_archive WHERE archived_at < ?').run(cutoffTime);
      
      console.log(`✅ Archive compacted: ${deleted.changes} old records removed`);
      
    } catch (error) {
      console.error('❌ Error compacting archive:', error.message);
    }
  }

  // Get block from archive
  getArchivedBlock(index) {
    try {
      const block = this.blockchain.db.prepare('SELECT * FROM block_archive WHERE idx = ?').get(index);
      return block ? this.blockchain._rowToBlock(block) : null;
    } catch (error) {
      console.error('❌ Error getting archived block:', error.message);
      return null;
    }
  }

  // Search in archived blocks
  searchArchivedBlocks(query) {
    try {
      const blocks = this.blockchain.db.prepare(`
        SELECT * FROM block_archive 
        WHERE data LIKE ? 
        ORDER BY idx DESC 
        LIMIT 100
      `).all(`%${query}%`);
      
      return blocks.map(block => this.blockchain._rowToBlock(block));
    } catch (error) {
      console.error('❌ Error searching archived blocks:', error.message);
      return [];
    }
  }
} 