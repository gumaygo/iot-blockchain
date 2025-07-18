// src/utils.js
import fs from 'fs';
import crypto from 'crypto';

const validators = JSON.parse(fs.readFileSync('./validators.json', 'utf8'));

/**
 * Verifikasi apakah sensor_id dan public_key cocok dengan daftar validator
 */
export function isValidValidator(sensor_id, publicKeyPem) {
  return validators.some(
    (v) =>
      v.sensor_id === sensor_id &&
      normalizeKey(v.public_key) === normalizeKey(publicKeyPem)
  );
}

/**
 * Normalize key (hapus newline tambahan)
 */
function normalizeKey(key) {
  return key.replace(/\r?\n/g, '').trim();
}

/**
 * Verifikasi signature berdasarkan data dan public key
 */
export function verifySignature(data, signature, publicKeyPem) {
  try {
    const verify = crypto.createVerify('SHA256');
    verify.update(data);
    verify.end();
    return verify.verify(publicKeyPem, signature, 'base64');
  } catch (e) {
    console.error('❌ Error verifying signature:', e.message);
    return false;
  }
}

/**
 * Tanda tangan data menggunakan private key lokal
 */
export function signData(data) {
  const privateKey = fs.readFileSync('./key/private_key.pem', 'utf8');
  const sign = crypto.createSign('SHA256');
  sign.update(data);
  sign.end();
  return sign.sign(privateKey, 'base64');
}

/**
 * Ambil public key dari file lokal
 */
export function getPublicKey() {
  return fs.readFileSync('./key/public_key.pem', 'utf8');
}
