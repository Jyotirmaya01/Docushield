/**
 * DocuShield Immutable Cryptographic Ledger (Hash-Chain)
 * Uses Web Crypto API SHA-256 to anchor every screening decision locally.
 */

import { dbInstance } from '../storage/db.js';

const STORAGE_KEY = 'docushield_hash_chain_v1';
const GENESIS_PREV_HASH = '0000000000000000000000000000000000000000000000000000000000000000';

function fallbackSha256(ascii) {
  function rightRotate(value, amount) {
    return (value >>> amount) | (value << (32 - amount));
  }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let i, j;
  let result = '';
  const words = [];
  const asciiBitLength = ascii.length * 8;
  let hash = [];
  const k = [];
  let primeCounter = 0;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (i = 0; i < 313; i += candidate) {
        isComposite[i] = candidate;
      }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  hash = hash.slice(0, 8);
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (i = 0; i < ascii.length; i++) {
    j = ascii.charCodeAt(i);
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const s0 = rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3);
      const s1 = rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10);
      w[i] = (i < 16) ? w[i] : (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      const s1h = rightRotate(hash[4], 6) ^ rightRotate(hash[4], 11) ^ rightRotate(hash[4], 25);
      const ch = (hash[4] & hash[5]) ^ (~hash[4] & hash[6]);
      const temp1 = hash[7] + s1h + ch + k[i] + w[i];
      const s0h = rightRotate(hash[0], 2) ^ rightRotate(hash[0], 13) ^ rightRotate(hash[0], 22);
      const maj = (hash[0] & hash[1]) ^ (hash[0] & hash[2]) ^ (hash[1] & hash[2]);
      const temp2 = s0h + maj;
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (i = 0; i < 8; i++) {
      hash[i] = (hash[i] + oldHash[i]) | 0;
    }
  }
  for (i = 0; i < 8; i++) {
    for (j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? '0' : '') + b.toString(16);
    }
  }
  return result;
}

async function sha256(str) {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
    try {
      const buffer = new TextEncoder().encode(str);
      const hashBuffer = await window.crypto.subtle.digest('SHA-256', buffer);
      const hashArray = Array.from(new Uint8Array(hashBuffer));
      return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch {}
  }
  return fallbackSha256(str);
}

function canonicalString(block) {
  return `${block.index}|${block.prevHash}|${block.timestamp}|${block.docId}|${block.officerId}|${block.riskScore}|${block.decision}|${block.travelerName}|${block.nationality}|${block.pathway || 'FULL_PIPELINE'}`;
}

export class HashChainLedger {
  constructor() {
    this.chain = [];
    this.initPromise = this.init();
  }

  async init() {
    // 1. Try local storage cache
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        this.chain = JSON.parse(saved);
        if (this.chain.length > 0) return;
      } catch (e) {
        console.warn('Corrupted ledger in localStorage, checking Dexie IndexedDB...');
      }
    }

    // 2. Try persistent Dexie IndexedDB
    try {
      const dbBlocks = await dbInstance.getAllBlocks();
      if (dbBlocks && dbBlocks.length > 0) {
        this.chain = dbBlocks;
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.chain));
        console.log(`[DocuShield Ledger] Restored ${this.chain.length} blocks from persistent Dexie IndexedDB`);
        return;
      }
    } catch (e) {
      console.warn('[DocuShield Ledger] Dexie check error:', e);
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
      pathway: 'SYSTEM',
      crossingCount: 0,
      officerId: 'SSB-ROOT-AUTH',
      reasons: ['Genesis block initialized for terminal CP-04-NORTH'],
      syncStatus: 'SYNCED',
      hash: ''
    };
    genesisBlock.hash = await sha256(canonicalString(genesisBlock));
    this.chain = [genesisBlock];
    
    // Seed initial frequent crossers and historical records for instant realistic testing
    await this.seedHistoricalRecords();
    this.save();
  }

  async seedHistoricalRecords() {
    // 1. Frequent crosser: Ramesh Thapa (pre-approved with clean crossing history)
    const prevBlock = this.chain[this.chain.length - 1];
    const frequentBlock = {
      index: this.chain.length,
      prevHash: prevBlock.hash,
      timestamp: new Date(Date.now() - 86400000 * 2).toISOString(),
      docId: 'NP-FC-991204',
      travelerName: 'RAMESH THAPA',
      nationality: 'NPL',
      docType: 'BORDER_PERMIT',
      riskScore: 8,
      decision: 'AUTO_APPROVED',
      pathway: 'FAST_LANE',
      crossingCount: 14,
      officerId: 'SSB-7489-N',
      reasons: ['Prior inspection verified: Panitanki Border Trade Permit'],
      syncStatus: 'SYNCED',
      hash: ''
    };
    frequentBlock.hash = await sha256(canonicalString(frequentBlock));
    this.chain.push(frequentBlock);

    // 2. Known flagged traveler: Vikram Singh (prior biometric anomaly / watchlist hit)
    const prevBlock2 = this.chain[this.chain.length - 1];
    const flaggedBlock = {
      index: this.chain.length,
      prevHash: prevBlock2.hash,
      timestamp: new Date(Date.now() - 86400000 * 5).toISOString(),
      docId: 'IND-FL-402911',
      travelerName: 'VIKRAM SINGH',
      nationality: 'IND',
      docType: 'PASSPORT',
      riskScore: 68,
      decision: 'ESCALATED_SECONDARY',
      pathway: 'OFFICER_REVIEW',
      crossingCount: 2,
      officerId: 'SSB-7489-N',
      reasons: ['Prior Security Alert: Document photo edge tampering detected on 2026-09-02'],
      syncStatus: 'SYNCED',
      hash: ''
    };
    flaggedBlock.hash = await sha256(canonicalString(flaggedBlock));
    this.chain.push(flaggedBlock);
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.chain));
    } catch (e) {
      console.error('LocalStorage write error in ledger:', e);
    }

    // Persist to Dexie IndexedDB for long-term durable storage
    try {
      this.chain.forEach(block => {
        dbInstance.addBlock(block).catch(() => {});
      });
    } catch (e) {
      // Background persistence error non-fatal
    }
  }

  /**
   * Lookup document crossing history in the immutable ledger
   * Corresponds to Step A2 (Ledger Lookup) in the System Architecture
   */
  async lookupDocumentHistory(docId) {
    await this.initPromise;
    if (!docId) return { found: false, count: 0, status: 'NOT_FOUND' };

    const normalizedId = String(docId).trim().toUpperCase();
    const matches = this.chain.filter(b => b.docId && String(b.docId).trim().toUpperCase() === normalizedId);

    if (matches.length === 0) {
      return {
        found: false,
        count: 0,
        status: 'NOT_FOUND',
        pathwayRecommendation: 'FULL_PIPELINE'
      };
    }

    const latest = matches[matches.length - 1];
    const hasFlags = matches.some(b => b.riskScore > 35 || b.decision === 'ESCALATED_SECONDARY');

    return {
      found: true,
      count: latest.crossingCount || matches.length,
      lastSeen: latest.timestamp,
      lastDecision: latest.decision,
      hasFlags: hasFlags,
      latestBlock: latest,
      pathwayRecommendation: hasFlags ? 'OFFICER_REVIEW' : 'FAST_LANE'
    };
  }

  async appendDecision({
    docId,
    travelerName,
    nationality,
    docType,
    riskScore,
    decision,
    pathway = 'FULL_PIPELINE',
    crossingCount = null,
    officerId,
    reasons = [],
    syncStatus = 'LOCAL PENDING'
  }) {
    await this.initPromise;
    const prevBlock = this.chain[this.chain.length - 1];
    
    // Calculate crossing frequency if not provided
    let calculatedCount = crossingCount;
    if (calculatedCount === null && docId) {
      const hist = await this.lookupDocumentHistory(docId);
      calculatedCount = hist.found ? hist.count + 1 : 1;
    }

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
      pathway: pathway,   // 'FAST_LANE' | 'FULL_PIPELINE' | 'OFFICER_REVIEW'
      crossingCount: calculatedCount || 1,
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
