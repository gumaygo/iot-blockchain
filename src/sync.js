// src/sync.js
import axios from 'axios';
import fs from 'fs';

const PEER_FILE = './peers.json';

export function getPeers() {
  return JSON.parse(fs.readFileSync(PEER_FILE, 'utf-8'));
}

export async function syncChain(localChain) {
  const peers = getPeers();
  for (const peer of peers) {
    try {
      const res = await axios.get(`${peer}/chain`);
      const remoteChain = res.data;
      if (remoteChain.length > localChain.length && isValidChain(remoteChain)) {
        fs.writeFileSync('./chain/chain.json', JSON.stringify(remoteChain, null, 2));
        console.log(`🔄 Synced chain from ${peer}`);
        break;
      }
    } catch (e) {
      console.warn(`❌ Failed to sync from ${peer}`);
    }
  }
}

function isValidChain(chain) {
  for (let i = 1; i < chain.length; i++) {
    if (chain[i].previousHash !== chain[i - 1].hash) return false;
  }
  return true;
}
