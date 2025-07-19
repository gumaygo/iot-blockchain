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
    return new Block(0, '2023-01-01T00:00:00.000Z', { message: 'Genesis Block' }, '0');
  }

  getLastIndex() {
    const row = this.db.prepare('SELECT MAX(idx) as maxIdx FROM block').get();
    return row && row.maxIdx !== null ? row.maxIdx : null;
  }

  getLatestBlock() {
    const row = this.db.prepare('SELECT * FROM block ORDER BY idx DESC LIMIT 1').get();
    if (!row) {
      const genesis = this.createGenesisBlock();
      this._insertBlock(genesis);
      return genesis;
    }
    return this._rowToBlock(row);
  }

  addBlock(data) {
    let lastIndex = this.getLastIndex();
    if (lastIndex === null) {
      const genesis = this.createGenesisBlock();
      this._insertBlock(genesis);
      lastIndex = 0;
    }
    const lastBlock = this.getLatestBlock();
    // Validasi data block
    if (!data || typeof data !== 'object' || typeof data.sensor_id !== 'string' || typeof data.value !== 'number' || typeof data.timestamp !== 'string') {
      throw new Error('Invalid block data');
    }
    const newBlock = new Block(
      lastBlock.index + 1,
      new Date().toISOString(),
      data,
      lastBlock.hash
    );
    this._insertBlock(newBlock);
    return newBlock;
  }

  getChain() {
    const rows = this.db.prepare('SELECT * FROM block ORDER BY idx ASC').all();
    return rows.map(row => this._rowToBlock(row));
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
