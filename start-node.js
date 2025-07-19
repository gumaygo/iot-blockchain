#!/usr/bin/env node

// Script untuk menjalankan node dengan IP yang berbeda
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';

const NODES = [
  { name: 'Node-1', address: '172.16.1.253:50051' },
  { name: 'Node-2', address: '172.16.2.253:50051' },
  { name: 'Node-3', address: '172.16.2.254:50051' }
];

function createConfigEnv(nodeAddress) {
  const config = `# Node Configuration
NODE_ADDRESS=${nodeAddress}
NODE_PORT=3000
GRPC_PORT=50051

# Network Configuration
PEER_DISCOVERY_INTERVAL=60000
HEALTH_CHECK_TIMEOUT=10000
SYNC_INTERVAL=30000

# Blockchain Configuration
GENESIS_TIMESTAMP=2023-01-01T00:00:00.000Z
BROADCAST_COOLDOWN=1000
SYNC_TIMEOUT=5000

# Database Configuration
DB_PATH=blockchain.sqlite

# Logging Configuration
LOG_LEVEL=info
`;
  
  fs.writeFileSync('./config.env', config);
  console.log(`📝 Created config.env for ${nodeAddress}`);
}

function startNode(nodeName, nodeAddress) {
  console.log(`🚀 Starting ${nodeName} with address ${nodeAddress}...`);
  
  // Create config.env for this node
  createConfigEnv(nodeAddress);
  
  const child = spawn('node', ['./src/app.js'], {
    stdio: 'inherit',
    shell: true
  });
  
  child.on('error', (error) => {
    console.error(`❌ Error starting ${nodeName}:`, error.message);
  });
  
  child.on('exit', (code) => {
    console.log(`📴 ${nodeName} exited with code ${code}`);
  });
  
  return child;
}

// Parse command line arguments
const args = process.argv.slice(2);
const nodeIndex = parseInt(args[0]) || 0;

if (nodeIndex >= 0 && nodeIndex < NODES.length) {
  const node = NODES[nodeIndex];
  startNode(node.name, node.address);
} else {
  console.log('❌ Invalid node index. Available nodes:');
  NODES.forEach((node, index) => {
    console.log(`  ${index}: ${node.name} (${node.address})`);
  });
  console.log('\nUsage: node start-node.js <node-index>');
  console.log('Example: node start-node.js 0  # Start Node-1');
} 