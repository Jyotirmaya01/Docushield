/**
 * DocuShield Store-and-Forward Background Sync Manager
 * Monitors network availability and flushes local cryptographic blocks
 * to central authority without ever blocking the border officer's lane throughput.
 */

import { ledgerInstance } from './hashChain.js';

export class SyncManager {
  constructor() {
    this.simulatedOffline = false;
    this.isSyncing = false;
    this.listeners = new Set();
    
    // Listen to real browser network state
    window.addEventListener('online', () => this.handleNetworkChange());
    window.addEventListener('offline', () => this.handleNetworkChange());
  }

  isOnline() {
    if (this.simulatedOffline) return false;
    return navigator.onLine;
  }

  setSimulatedOffline(val) {
    this.simulatedOffline = val;
    this.handleNetworkChange();
  }

  subscribe(callback) {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  notify() {
    const status = {
      isOnline: this.isOnline(),
      simulated: this.simulatedOffline,
      isSyncing: this.isSyncing
    };
    for (const listener of this.listeners) {
      listener(status);
    }
  }

  async handleNetworkChange() {
    this.notify();
    if (this.isOnline()) {
      await this.flushQueue();
    }
  }

  async flushQueue() {
    if (this.isSyncing || !this.isOnline()) return;
    this.isSyncing = true;
    this.notify();

    try {
      const pending = await ledgerInstance.getPendingSyncBlocks();
      if (pending.length > 0) {
        // Simulate secure HTTPS push to Central Ministry of Home Affairs ledger node
        await new Promise(resolve => setTimeout(resolve, 1200));
        const indices = pending.map(b => b.index);
        await ledgerInstance.markBlocksAsSynced(indices);
      }
    } catch (err) {
      console.error('Background sync encountered error:', err);
    } finally {
      this.isSyncing = false;
      this.notify();
    }
  }
}

export const syncInstance = new SyncManager();
