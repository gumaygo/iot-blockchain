// src/snapshot.js
import fs from 'fs';
import path from 'path';

const SNAPSHOT_DIR = './snapshot';

export function saveSnapshot(chain) {
  if (!fs.existsSync(SNAPSHOT_DIR)) fs.mkdirSync(SNAPSHOT_DIR);
  const filename = `snapshot-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
  const filepath = path.join(SNAPSHOT_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(chain, null, 2));
  console.log(`📸 Snapshot saved: ${filepath}`);
}
