/**
 * DocuShield Immutable Cryptographic Ledger (Hash-Chain)
 * Uses Web Crypto API SHA-256 to anchor every screening decision locally.
 */

const STORAGE_KEY = 'docushield_hash_chain_v1';
const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

async function sha256(str) {
  const buffer = new TextEncoder().encode(str);
  const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

function canonicalString(block) {
  return `${block.index}|${block.prevHash}|${block.timestamp}|${block.docId}|${block.officerId}|${block.riskScore}|${block.decision}|${block.travelerName}|${block.nationality}`;
}

export class HashChainLedger {
  constructor() {
    this.chain = [];
    this.initPromise = this.init();
  }

  async init() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.chain = JSON.parse(saved);
        if (this.chain.length > 0) return;
      } catch (e) {
        console.warn('Corrupted ledger found, re-initializing genesis block');
      }
    }

    // Initialize Genesis Block if empty
    const genesisBlock = {
      index: 0,
      prevHash: GENESIS_PREV_HASH,
      timestamp: '2026-09-05T06:00:00.000Z',
      docId: 'GENESIS_ANCHOR_PANITANKI_04',
      travelerName: 'SYSTEM_GENESIS_ROOT',
      nationality: 'IND',
      docType: 'TERMINAL_ROOT',
      riskScore: 0,
      decision: 'TERMINAL_INITIALIZED',
      officerId: 'SSB-ROOT-AUTH',
      reasons: ['Genesis block initialized for terminal CP-04-NORTH'],
      syncStatus: 'SYNCED',
      hash: ''
    };
    genesisBlock.hash = await sha256(canonicalString(genesisBlock));
    this.chain = [genesisBlock];
    this.save();
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.chain));
    } catch (e) {
      console.error('LocalStorage write error in ledger:', e);
    }
  }

  async appendDecision({
    docId,
    travelerName,
    nationality,
    docType,
    riskScore,
    decision,
    officerId,
    reasons = [],
    syncStatus = 'LOCAL PENDING'
  }) {
    await this.initPromise;
    const prevBlock = this.chain[this.chain.length - 1];
    const newBlock = {
      index: this.chain.length,
      prevHash: prevBlock.hash,
      timestamp: new Date().toISOString(),
      docId: docId || `DOC-${Math.floor(100000 + Math.random() * 900000)}`,
      travelerName: travelerName || 'UNKNOWN TRAVELER',
      nationality: nationality || 'IND',
      docType: docType || 'PASSPORT',
      riskScore: Math.round(riskScore),
      decision: decision, // 'AUTO_APPROVED' | 'ESCALATED_SECONDARY' | 'OFFICER_OVERRIDE'
      officerId: officerId || 'SSB-7489-N',
      reasons: reasons,
      syncStatus: syncStatus,
      hash: ''
    };

    newBlock.hash = await sha256(canonicalString(newBlock));
    this.chain.push(newBlock);
    this.save();
    return newBlock;
  }

  async getBlocks() {
    await this.initPromise;
    return [...this.chain].reverse(); // newest first
  }

  async getPendingSyncBlocks() {
    await this.initPromise;
    return this.chain.filter(b => b.syncStatus === 'LOCAL PENDING');
  }

  async markBlocksAsSynced(indices) {
    await this.initPromise;
    let changed = false;
    this.chain.forEach(b => {
      if (indices.includes(b.index) && b.syncStatus !== 'SYNCED') {
        b.syncStatus = 'SYNCED';
        changed = true;
      }
    });
    if (changed) {
      this.save();
    }
  }

  async verifyChainIntegrity() {
    await this.initPromise;
    for (let i = 0; i < this.chain.length; i++) {
      const current = this.chain[i];
      const recalculatedHash = await sha256(canonicalString(current));
      
      if (current.hash !== recalculatedHash) {
        return {
          isValid: false,
          errorIndex: i,
          reason: `Hash mismatch at block #${i}: recorded ${current.hash.substring(0, 10)}... calculated ${recalculatedHash.substring(0, 10)}...`
        };
      }

      if (i > 0) {
        const prev = this.chain[i - 1];
        if (current.prevHash !== prev.hash) {
          return {
            isValid: false,
            errorIndex: i,
            reason: `Broken chain link at block #${i}: parent pointer does not match block #${i - 1} hash`
          };
        }
      } else {
        if (current.prevHash !== GENESIS_PREV_HASH) {
          return {
            isValid: false,
            errorIndex: 0,
            reason: 'Genesis block parent hash invalid'
          };
        }
      }
    }

    return {
      isValid: true,
      totalBlocks: this.chain.length,
      headHash: this.chain[this.chain.length - 1].hash
    };
  }
}

export const ledgerInstance = new HashChainLedger();
