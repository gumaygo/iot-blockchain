// src/peer-discovery.js - Dynamic Peer Discovery & Health Monitoring
import grpc from '@grpc/grpc-js';
import protoLoader from '@grpc/proto-loader';
import fs from 'fs';
import path from 'path';

const __dirname = path.resolve();
const packageDef = protoLoader.loadSync(path.join(__dirname, 'proto', 'blockchain.proto'));
const grpcObj = grpc.loadPackageDefinition(packageDef);
const BlockchainService = grpcObj.blockchain.Blockchain;

export class PeerDiscovery {
  constructor() {
    this.peers = new Map(); // peer -> { address, lastSeen, health, chainLength }
    this.discoveryInterval = 60000; // 1 menit
    this.healthTimeout = 10000; // 10 detik
    this.maxPeers = 10;
    this.loadStaticPeers();
  }

  loadStaticPeers() {
    try {
      const staticPeers = JSON.parse(fs.readFileSync('./peers.json', 'utf-8'));
      staticPeers.forEach(peer => {
        this.peers.set(peer, {
          address: peer,
          lastSeen: Date.now(),
          health: 'unknown',
          chainLength: 0,
          responseTime: 0
        });
      });
      console.log(`📡 Loaded ${staticPeers.length} static peers`);
    } catch (e) {
      console.warn('⚠️ Could not load static peers:', e.message);
    }
  }

  // Add new peer dynamically
  addPeer(address) {
    if (this.peers.size >= this.maxPeers) {
      console.warn(`⚠️ Max peers reached (${this.maxPeers}), removing oldest peer`);
      this.removeOldestPeer();
    }
    
    this.peers.set(address, {
      address,
      lastSeen: Date.now(),
      health: 'unknown',
      chainLength: 0,
      responseTime: 0
    });
    
    console.log(`✅ Added new peer: ${address}`);
  }

  // Remove oldest peer
  removeOldestPeer() {
    let oldestPeer = null;
    let oldestTime = Date.now();
    
    for (const [address, peer] of this.peers) {
      if (peer.lastSeen < oldestTime) {
        oldestTime = peer.lastSeen;
        oldestPeer = address;
      }
    }
    
    if (oldestPeer) {
      this.peers.delete(oldestPeer);
      console.log(`🗑️ Removed oldest peer: ${oldestPeer}`);
    }
  }

  // Health check for all peers
  async healthCheck() {
    console.log('🏥 Starting peer health check...');
    const promises = [];
    
    for (const [address, peer] of this.peers) {
      promises.push(this.checkPeerHealth(address, peer));
    }
    
    await Promise.allSettled(promises);
    
    // Remove unhealthy peers
    this.removeUnhealthyPeers();
    
    console.log(`📊 Peer health status: ${this.getHealthyPeers().length}/${this.peers.size} healthy`);
  }

  // Check individual peer health
  async checkPeerHealth(address, peer) {
    const startTime = Date.now();
    
    try {
      const ca = fs.readFileSync('./key/ca.crt');
      const clientKey = fs.readFileSync('./key/client.key');
      const clientCert = fs.readFileSync('./key/client.crt');
      const credentials = grpc.credentials.createSsl(ca, clientKey, clientCert);
      
      const client = new BlockchainService(address, credentials);
      
      const response = await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error('Health check timeout'));
        }, this.healthTimeout);
        
        client.GetBlockchain({}, (err, response) => {
          clearTimeout(timeout);
          if (err) {
            reject(err);
          } else {
            resolve(response);
          }
        });
      });
      
      const responseTime = Date.now() - startTime;
      
      // Update peer info
      this.peers.set(address, {
        ...peer,
        lastSeen: Date.now(),
        health: 'healthy',
        chainLength: response.chain.length,
        responseTime
      });
      
      console.log(`✅ Peer ${address} healthy (${responseTime}ms, chain: ${response.chain.length})`);
      
    } catch (error) {
      // Update peer as unhealthy
      this.peers.set(address, {
        ...peer,
        health: 'unhealthy',
        lastSeen: Date.now()
      });
      
      console.warn(`❌ Peer ${address} unhealthy: ${error.message}`);
    }
  }

  // Remove unhealthy peers
  removeUnhealthyPeers() {
    const now = Date.now();
    const unhealthyTimeout = 5 * 60 * 1000; // 5 menit
    
    for (const [address, peer] of this.peers) {
      if (peer.health === 'unhealthy' && (now - peer.lastSeen) > unhealthyTimeout) {
        this.peers.delete(address);
        console.log(`🗑️ Removed unhealthy peer: ${address}`);
      }
    }
  }

  // Get healthy peers only
  getHealthyPeers() {
    const healthyPeers = [];
    for (const [address, peer] of this.peers) {
      if (peer.health === 'healthy') {
        healthyPeers.push(address);
      }
    }
    return healthyPeers;
  }

  // Get all peers
  getAllPeers() {
    return Array.from(this.peers.keys());
  }

  // Get peer info
  getPeerInfo(address) {
    return this.peers.get(address);
  }

  // Get best peer (fastest response time)
  getBestPeer() {
    let bestPeer = null;
    let bestResponseTime = Infinity;
    
    for (const [address, peer] of this.peers) {
      if (peer.health === 'healthy' && peer.responseTime < bestResponseTime) {
        bestResponseTime = peer.responseTime;
        bestPeer = address;
      }
    }
    
    return bestPeer;
  }

  // Start discovery service
  startDiscovery() {
    console.log('🚀 Starting peer discovery service...');
    
    // Initial health check
    this.healthCheck();
    
    // Periodic health check
    setInterval(() => {
      this.healthCheck();
    }, this.discoveryInterval);
  }

  // Stop discovery service
  stopDiscovery() {
    console.log('🛑 Stopping peer discovery service...');
    // Clear intervals if needed
  }
} 