/**
 * DocuShield Store-and-Forward Background Sync Manager
 * Monitors network availability and flushes local cryptographic blocks
 * to central authority without ever blocking the border officer's lane throughput.
 */

import { ledgerInstance } from './hashChain.js';
import { BackendAPI } from '../api/backendClient.js';

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

    // Health check ping: never block if backend is down
    const backendOnline = await BackendAPI.isAvailable();
    if (!backendOnline) {
      console.log('[SyncManager] Backend health check failed or offline; skipping batch sync.');
      return;
    }

    this.isSyncing = true;
    this.notify();

    try {
      const pending = await ledgerInstance.getPendingSyncBlocks();
      if (pending && pending.length > 0) {
        // Map local hash-chain blocks into server-expected schema
        const entries = pending.map(b => ({
          record_id: b.docId ? `REC-${b.docId}-${b.index}` : `REC-BLOCK-${b.index}`,
          checkpoint_id: b.checkpointId || 'CP-04-NORTH',
          officer_id: b.officerId || 'SSB-7489-N',
          timestamp: b.timestamp || new Date().toISOString(),
          risk_score: b.riskScore || 0,
          decision: b.decision || 'CLEARED',
          prior_hash: b.prevHash,
          entry_hash: b.hash,
          traveler_name: b.travelerName || '',
          nationality: b.nationality || '',
          pathway: b.pathway || 'STANDARD_INSPECTION',
        }));

        const result = await BackendAPI.syncAuditLog(entries);
        if (result && result.ok) {
          console.log(`[SyncManager] Successfully flushed ${entries.length} blocks to central audit log.`);
          const indices = pending.map(b => b.index);
          await ledgerInstance.markBlocksAsSynced(indices);
        } else {
          console.warn('[SyncManager] Central audit sync rejected or failed:', result?.data || result?.error);
        }
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
