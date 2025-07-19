// src/blockchain.js
import { createHash } from 'crypto';
import Database from 'better-sqlite3';

export class Block {
  constructor(index, timestamp, data, previousHash = '', hash = null) {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;
    this.previousHash = previousHash;
    this.hash = hash || this.calculateHash();
  }

  calculateHash() {
    return createHash('sha256')
      .update(this.index + this.timestamp + JSON.stringify(this.data) + this.previousHash)
      .digest('hex');
  }
}

export class Blockchain {
  constructor(db) {
    this.db = db;
    this._initTable();
  }

  static async create() {
    const db = new Database('./blockchain.sqlite');
    const blockchain = new Blockchain(db);
    await blockchain.init();
    return blockchain;
  }

  _initTable() {
    this.db.prepare(`CREATE TABLE IF NOT EXISTS block (
      idx INTEGER PRIMARY KEY,
      timestamp TEXT NOT NULL,
      data TEXT NOT NULL,
      previousHash TEXT NOT NULL,
      hash TEXT NOT NULL
    )`).run();
  }

  async init() {
    const lastIndex = this.getLastIndex();
    if (lastIndex === null) {
      // DB kosong, buat genesis block
      const genesis = this.createGenesisBlock();
      this._insertBlock(genesis);
    }
  }

  createGenesisBlock() {
    // Use fixed timestamp for consistent genesis block across all nodes
    return new Block(0, '2023-01-01T00:00:00.000Z', { message: 'Genesis Block' }, '0');
  }

  getLastIndex() {
    const row = this.db.prepare('SELECT MAX(idx) as maxIdx FROM block').get();
    return row && row.maxIdx !== null ? row.maxIdx : null;
  }

  getLatestBlock() {
    const row = this.db.prepare('SELECT * FROM block ORDER BY idx DESC LIMIT 1').get();
    if (!row) {
      // Cek apakah genesis block sudah ada
      const genesisRow = this.db.prepare('SELECT * FROM block WHERE idx = 0').get();
      if (!genesisRow) {
        const genesis = this.createGenesisBlock();
        this._insertBlock(genesis);
        return genesis;
      }
      return this._rowToBlock(genesisRow);
    }
    return this._rowToBlock(row);
  }

  addBlock(data) {
    // Validasi data block
    if (!data || typeof data !== 'object' || typeof data.sensor_id !== 'string' || typeof data.value !== 'number' || typeof data.timestamp !== 'string') {
      throw new Error('Invalid block data');
    }
    
    const lastBlock = this.getLatestBlock();
    const newIndex = lastBlock.index + 1;
    
    // Cek apakah block dengan index ini sudah ada (prinsip blockchain: tidak overwrite)
    try {
      const existingBlock = this.db.prepare('SELECT * FROM block WHERE idx = ?').get(newIndex);
      if (existingBlock) {
        console.warn(`⚠️ Block ${newIndex} already exists, skipping... (blockchain immutability)`);
        return this._rowToBlock(existingBlock);
      }
    } catch (e) {
      // Block tidak ada, lanjutkan
    }
    
    const newBlock = new Block(
      newIndex,
      new Date().toISOString(),
      data,
      lastBlock.hash
    );
    
    // Verify block consistency sebelum append
    if (newBlock.previousHash !== lastBlock.hash) {
      throw new Error(`Block consistency error: previousHash mismatch`);
    }
    
    // APPEND block baru (tidak ada delete!)
    this._insertBlock(newBlock);
    
    // Verify append berhasil
    const insertedBlock = this.db.prepare('SELECT * FROM block WHERE idx = ?').get(newIndex);
    if (!insertedBlock) {
      throw new Error(`Failed to append block ${newIndex}`);
    }
    
    console.log(`✅ Block ${newIndex} appended to blockchain`);
    return newBlock;
  }

  getChain() {
    const rows = this.db.prepare('SELECT * FROM block ORDER BY idx ASC').all();
    const chain = rows.map(row => this._rowToBlock(row));
    
    // Verify chain consistency (tidak ada delete, hanya append)
    for (let i = 1; i < chain.length; i++) {
      if (chain[i].index !== i) {
        console.error(`❌ Chain inconsistency: block at index ${i} has wrong index ${chain[i].index}`);
        throw new Error('Chain index inconsistency detected');
      }
      if (chain[i].previousHash !== chain[i-1].hash) {
        console.error(`❌ Chain inconsistency: block ${i} previousHash mismatch`);
        throw new Error('Chain hash inconsistency detected');
      }
    }
    
    return chain;
  }

  _insertBlock(block) {
    this.db.prepare('INSERT INTO block (idx, timestamp, data, previousHash, hash) VALUES (?, ?, ?, ?, ?)')
      .run(block.index, block.timestamp, JSON.stringify(block.data), block.previousHash, block.hash);
  }

  _rowToBlock(row) {
    return new Block(
      row.idx,
      row.timestamp,
      JSON.parse(row.data),
      row.previousHash,
      row.hash
    );
  }
}
