// validate-keys.js
import fs from 'fs';
import path from 'path';

const REQUIRED_FILES = [
  'server.crt',
  'server.key',
  'client.crt',
  'client.key',
  'ca.crt'
];

const folder = './key';
let allGood = true;

console.log('🔍 Validating TLS key setup...\n');

for (const file of REQUIRED_FILES) {
  const filePath = path.join(folder, file);
  if (fs.existsSync(filePath)) {
    const size = fs.statSync(filePath).size;
    console.log(`✅ Found: ${file} (${size} bytes)`);
    if (size < 100) {
      console.warn(`⚠️ Warning: ${file} is too small or possibly invalid`);
      allGood = false;
    }
  } else {
    console.error(`❌ Missing: ${file}`);
    allGood = false;
  }
}

if (allGood) {
  console.log('\n✅ All required TLS files are present and look valid.\n');
} else {
  console.error('\n❌ TLS validation failed. Please fix missing or invalid files in /key/\n');
  process.exit(1);
}
