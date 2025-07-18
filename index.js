// index.js
import app from './src/node.js';
import { syncChain } from './src/sync.js';
import { Blockchain } from './src/blockchain.js';
import { saveSnapshot } from './src/snapshot.js';

const PORT = process.env.PORT || 3000;

// Buat instance blockchain untuk snapshot
const blockchain = new Blockchain();

(async () => {
  // Sync dari node lain saat startup
  await syncChain(blockchain.chain);

  // Jalankan server Express
  app.listen(PORT, () => {
    console.log(`✅ Blockchain node running on port ${PORT}`);
  });

  // Simpan snapshot tiap 1 menit
  setInterval(() => {
    saveSnapshot(blockchain.chain);
  }, 60_000);
})();
