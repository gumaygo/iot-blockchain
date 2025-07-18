// src/blockchain.js
import { createHash } from 'crypto';
import fs from 'fs';

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
    this.chainFile = './chain/chain.json';
    if (fs.existsSync(this.chainFile)) {
      const raw = fs.readFileSync(this.chainFile, 'utf-8');
      try {
        this.chain = JSON.parse(raw);
      } catch (e) {
        console.warn('⚠️ chain.json corrupt, creating new chain.');
        this.chain = [this.createGenesisBlock()];
        fs.writeFileSync(this.chainFile, JSON.stringify(this.chain, null, 2));
      }
    } else {
      this.chain = [this.createGenesisBlock()];
      fs.writeFileSync(this.chainFile, JSON.stringify(this.chain, null, 2));
    }
  }

  createGenesisBlock() {
    return new Block(0, new Date().toISOString(), { message: 'Genesis Block' }, '0');
  }

  getLatestBlock() {
    return this.chain[this.chain.length - 1];
  }

  addBlock(data) {
    const lastBlock = this.getLatestBlock();
    const newBlock = new Block(
      this.chain.length,
      new Date().toISOString(),
      data,
      lastBlock.hash
    );
    this.chain.push(newBlock);
    fs.writeFileSync(this.chainFile, JSON.stringify(this.chain, null, 2));
    return newBlock;
  }
}
