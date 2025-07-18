// src/blockchain.js
import { createHash } from 'crypto';
import { Level } from 'level';

export class Block {
  constructor(index, timestamp, data, previousHash = '') {
    this.index = index;
    this.timestamp = timestamp;
    this.data = data;
    this.previousHash = previousHash;
    this.hash = this.calculateHash();
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
  }

  static async create() {
    const db = new Level('./blockchaindb', { valueEncoding: 'json' });
    await db.open(); // pastikan DB sudah open
    const blockchain = new Blockchain(db);
    await blockchain.init();
    return blockchain;
  }

  async init() {
    try {
      const lastIndex = await this.getLastIndex();
      if (lastIndex === null) {
        // DB kosong, buat genesis block
        const genesis = this.createGenesisBlock();
        await this.db.put('block_0', genesis);
        await this.db.put('last', 0);
      }
    } catch (e) {
      console.warn('⚠️ Error init LevelDB:', e.message);
    }
  }

  createGenesisBlock() {
    // Timestamp tetap agar hash genesis block konsisten di semua node
    return new Block(0, '2023-01-01T00:00:00.000Z', { message: 'Genesis Block' }, '0');
  }

  async getLastIndex() {
    try {
      return await this.db.get('last');
    } catch {
      return null;
    }
  }

  async getLatestBlock() {
    let lastIndex = await this.getLastIndex();
    if (lastIndex === null) {
      // DB kosong, buat genesis block dulu
      const genesis = this.createGenesisBlock();
      await this.db.put('block_0', genesis);
      await this.db.put('last', 0);
      return genesis;
    }
    let block;
    try {
      block = await this.db.get(`block_${lastIndex}`);
    } catch {
      // Jika block terakhir tidak ada, buat genesis block
      const genesis = this.createGenesisBlock();
      await this.db.put('block_0', genesis);
      await this.db.put('last', 0);
      return genesis;
    }
    return block;
  }

  async addBlock(data) {
    let lastIndex = await this.getLastIndex();
    if (lastIndex === null) {
      // DB kosong, buat genesis block dulu
      const genesis = this.createGenesisBlock();
      await this.db.put('block_0', genesis);
      await this.db.put('last', 0);
      lastIndex = 0;
    }
    let lastBlock;
    try {
      lastBlock = await this.db.get(`block_${lastIndex}`);
    } catch {
      // Jika block terakhir tidak ada, buat genesis block
      const genesis = this.createGenesisBlock();
      await this.db.put('block_0', genesis);
      await this.db.put('last', 0);
      lastBlock = genesis;
      lastIndex = 0;
    }
    if (!lastBlock) {
      // Fallback ekstra: jika tetap undefined, buat genesis block
      const genesis = this.createGenesisBlock();
      await this.db.put('block_0', genesis);
      await this.db.put('last', 0);
      lastBlock = genesis;
      lastIndex = 0;
    }
    // Validasi data block
    if (!data || typeof data !== 'object' || typeof data.sensor_id !== 'string' || typeof data.value !== 'number' || typeof data.timestamp !== 'string') {
      throw new Error('Invalid block data');
    }
    const newBlock = new Block(
      lastIndex + 1,
      new Date().toISOString(),
      data,
      lastBlock.hash
    );
    await this.db.put(`block_${newBlock.index}`, newBlock);
    await this.db.put('last', newBlock.index);
    return newBlock;
  }

  async getChain() {
    const chain = [];
    let idx = 0;
    while (true) {
      try {
        const block = await this.db.get(`block_${idx}`);
        chain.push(block);
        idx++;
      } catch {
        break;
      }
    }
    return chain;
  }
}
