// simulateSender.js
import axios from 'axios';
import { signData, getPublicKey } from './src/utils.js';
import dotenv from 'dotenv';
dotenv.config();

const ENDPOINT = process.env.SENSOR_ENDPOINT || 'http://localhost:3000/add-sensor-data';
const INTERVAL_MS = parseInt(process.env.SENSOR_INTERVAL_MS || '0', 10); // 0 = sekali saja

function sendSensorData() {
  const sensor_id = process.env.SENSOR_ID || 'validator-01';
  const value = Number(process.env.SENSOR_VALUE || 712.5);
  const timestamp = new Date().toISOString();
  const rawData = `${sensor_id}|${value}|${timestamp}`;
  const signature = signData(rawData);
  const public_key = getPublicKey();

  const payload = {
    sensor_id,
    value,
    timestamp,
    signature,
    public_key
  };

  axios.post(ENDPOINT, payload)
    .then((res) => {
      console.log('✅ Sukses kirim data:', res.data);
    })
    .catch((err) => {
      console.error('❌ Gagal kirim:', err.response?.data || err.message);
    });
}

if (INTERVAL_MS > 0) {
  setInterval(sendSensorData, INTERVAL_MS);
  sendSensorData();
} else {
  sendSensorData();
}
