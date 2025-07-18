// simulateSender.js
import axios from 'axios';
import { signData, getPublicKey } from './src/utils.js';

const sensor_id = 'validator-01';
const value = 712.5;
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

axios.post('http://172.16.1.253:3000/add-sensor-data', payload)
  .then((res) => {
    console.log('✅ Sukses kirim data:', res.data);
  })
  .catch((err) => {
    console.error('❌ Gagal kirim:', err.response?.data || err.message);
  });
