// src/blockchain.js
import { createHash } from 'crypto';
import level from 'level';

const db = level('./blockchaindb', { valueEncoding: 'json' });

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
  constructor() {
    this.db = db;
    this.init();
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
    return new Block(0, new Date().toISOString(), { message: 'Genesis Block' }, '0');
  }

  async getLastIndex() {
    try {
      return await this.db.get('last');
    } catch {
      return null;
    }
  }

  async getLatestBlock() {
    const lastIndex = await this.getLastIndex();
    if (lastIndex === null) return null;
    return await this.db.get(`block_${lastIndex}`);
  }

  async addBlock(data) {
    const lastIndex = await this.getLastIndex();
    let lastBlock;
    if (lastIndex === null) {
      lastBlock = this.createGenesisBlock();
    } else {
      lastBlock = await this.db.get(`block_${lastIndex}`);
    }
    const newBlock = new Block(
      (lastIndex === null ? 1 : lastIndex + 1),
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
