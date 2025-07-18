// src/audit.js
import fs from 'fs';
import path from 'path';

const AUDIT_LOG = './audit/log.txt';

/**
 * Menyimpan entri audit ke file log.txt
 */
export function logAudit(entry) {
  const line = `[${new Date().toISOString()}] ${entry}\n`;
  fs.appendFileSync(AUDIT_LOG, line);
}
