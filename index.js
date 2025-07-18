import { syncChain } from './src/sync.js';
import fs from 'fs';

let localChain = [];
try {
  localChain = JSON.parse(fs.readFileSync('./chain/chain.json', 'utf-8'));
  console.log(`Chain lokal sebelum sync: ${localChain.length} block`);
} catch {
  localChain = [];
  console.log('Chain lokal tidak ditemukan, mulai dari kosong.');
}

syncChain(localChain).then(() => {
  const updatedChain = JSON.parse(fs.readFileSync('./chain/chain.json', 'utf-8'));
  console.log(`Chain lokal setelah sync: ${updatedChain.length} block`);
  process.exit(0);
});
