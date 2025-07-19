// simulateSender.js
import axios from 'axios';
import { signData, getPublicKey } from './src/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const ENDPOINT = process.env.SENSOR_ENDPOINT || 'http://172.16.2.253:3000/add-sensor-data';
const INTERVAL_MS = parseInt(process.env.SENSOR_INTERVAL_MS || '0', 10); // 0 = sekali saja
const RANDOM = process.env.SENSOR_RANDOM === '1';
const BATCH_SIZE = parseInt(process.env.SENSOR_BATCH_SIZE || '1', 10);
const RETRY_LIMIT = parseInt(process.env.SENSOR_RETRY_LIMIT || '3', 10);

function getRandomValue() {
  // Range bisa diatur sesuai kebutuhan
  return Math.round((Math.random() * 1000 + Number.EPSILON) * 100) / 100;
}

async function sendSensorData(retry = 0) {
  const sensor_id = process.env.SENSOR_ID || 'validator-01';
  const value = RANDOM ? getRandomValue() : Number(process.env.SENSOR_VALUE || 712.5);
  const timestamp = new Date().toISOString();
  const rawData = `${sensor_id}|${value}|${timestamp}`;
  const signature = signData(rawData);
  const public_key = getPublicKey();

  if (!signature || !public_key) {
    console.error(`[${timestamp}] ❌ Tidak bisa membuat signature/public key. Cek file key!`);
    process.exit(1);
  }

  const payload = {
    sensor_id,
    value,
    timestamp,
    signature,
    public_key
  };

  try {
    const res = await axios.post(ENDPOINT, payload);
    console.log(`[${timestamp}] ✅ Sukses kirim data:`, res.data);
  } catch (err) {
    console.error(`[${timestamp}] ❌ Gagal kirim:`, err.response?.data || err.message);
    if (retry < RETRY_LIMIT) {
      console.log(`[${timestamp}] 🔁 Retry ke-${retry + 1}...`);
      setTimeout(() => sendSensorData(retry + 1), 1000 * (retry + 1));
    }
  }
}

async function sendBatch() {
  for (let i = 0; i < BATCH_SIZE; i++) {
    await sendSensorData();
  }
}

if (INTERVAL_MS > 0) {
  const interval = setInterval(sendBatch, INTERVAL_MS);
  sendBatch();
  process.on('SIGINT', () => {
    console.log('\n🛑 Dihentikan oleh user.');
    clearInterval(interval);
    process.exit(0);
  });
  process.on('SIGTERM', () => {
    console.log('\n🛑 Dihentikan oleh sistem.');
    clearInterval(interval);
    process.exit(0);
  });
} else {
  sendBatch();
}
