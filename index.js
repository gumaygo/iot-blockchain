import { syncChain } from './src/sync.js';
import fs from 'fs';

let localChain = [];
try {
  localChain = JSON.parse(fs.readFileSync('./chain/chain.json', 'utf-8'));
} catch {
  localChain = [];
}

syncChain(localChain);
