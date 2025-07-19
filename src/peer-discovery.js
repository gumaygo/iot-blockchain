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
  constructor(nodeAddress = null) {
    this.peers = new Map();
    this.nodeAddress = nodeAddress; // IP:port dari node ini
    this.discoveryInterval = 60000; // 1 menit
    this.healthTimeout = 10000; // 10 detik
    this.maxPeers = 10;
    this.loadStaticPeers();
  }

  loadStaticPeers() {
    try {
      const peersPath = path.join(process.cwd(), 'peers.json');
      const staticPeers = JSON.parse(fs.readFileSync(peersPath, 'utf8'));
      
      // Filter out self from peer list
      const filteredPeers = staticPeers.filter(peer => peer !== this.nodeAddress);
      
      console.log(`📡 Loaded ${filteredPeers.length} static peers (excluded self: ${this.nodeAddress})`);
      
      // Initialize peers
      filteredPeers.forEach(peer => {
        this.peers.set(peer, {
          address: peer,
          health: 'unknown',
          lastSeen: null,
          chainLength: 0,
          responseTime: null
        });
      });
    } catch (error) {
      console.warn('⚠️ Could not load static peers:', error.message);
    }
  }

  // Add new peer dynamically
  addPeer(peerAddress) {
    if (peerAddress !== this.nodeAddress && !this.peers.has(peerAddress)) {
      this.peers.set(peerAddress, {
        address: peerAddress,
        health: 'unknown',
        lastSeen: null,
        chainLength: 0,
        responseTime: null
      });
      console.log(`➕ Added new peer: ${peerAddress}`);
    }
  }

  // Remove peer
  removePeer(peerAddress) {
    if (this.peers.has(peerAddress)) {
      this.peers.delete(peerAddress);
      console.log(`➖ Removed peer: ${peerAddress}`);
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

  // Get healthy peers (exclude self)
  getHealthyPeers() {
    const healthyPeers = [];
    for (const [peer, info] of this.peers) {
      if (info.health === 'healthy' && peer !== this.nodeAddress) {
        healthyPeers.push(peer);
      }
    }
    return healthyPeers;
  }

  // Get all peers (exclude self)
  getAllPeers() {
    const allPeers = [];
    for (const [peer, info] of this.peers) {
      if (peer !== this.nodeAddress) {
        allPeers.push(peer);
      }
    }
    return allPeers;
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

  // Update peer health
  updatePeerHealth(peer, health, chainLength = 0, responseTime = null) {
    if (this.peers.has(peer)) {
      const peerInfo = this.peers.get(peer);
      peerInfo.health = health;
      peerInfo.lastSeen = Date.now();
      peerInfo.chainLength = chainLength;
      peerInfo.responseTime = responseTime;
      this.peers.set(peer, peerInfo);
    }
  }

  // Get peer status
  getPeerStatus() {
    const status = {
      total: 0,
      healthy: 0,
      unhealthy: 0,
      unknown: 0,
      peers: []
    };

    for (const [peer, info] of this.peers) {
      if (peer !== this.nodeAddress) {
        status.total++;
        status[info.health]++;
        status.peers.push({
          address: peer,
          health: info.health,
          lastSeen: info.lastSeen,
          chainLength: info.chainLength,
          responseTime: info.responseTime
        });
      }
    }

    return status;
  }
} 