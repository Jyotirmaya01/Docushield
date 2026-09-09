/**
 * DocuShield Local Storage Manager (Dexie.js IndexedDB Wrapper)
 * Offline-first persistent storage for border document verification,
 * cryptographic hash-chain blocks, traveler fast-lane profiles, and sync queues.
 */

class LocalDatabaseManager {
  constructor() {
    this.db = null;
    this.isInitialized = false;
    this.persisted = false;
    this.storageEstimate = { quota: 0, usage: 0, percentUsed: 0 };
    this.initPromise = this.init();
  }

  async init() {
    if (this.isInitialized) return this.db;

    try {
      const DexieClass = window.Dexie || (typeof Dexie !== 'undefined' ? Dexie : null);
      if (!DexieClass) {
        console.warn('[DocuShield DB] Dexie.js not found in global window; will retry or use fallback.');
        return null;
      }

      this.db = new DexieClass('DocuShield_Border_DB');

      // Schema Definitions
      this.db.version(1).stores({
        blocks: '++id, index, hash, prevHash, docId, travelerName, nationality, timestamp, decision, syncStatus',
        travelers: 'docNumber, fullName, nationality, pathway, crossingCount, lastCrossing, riskLevel',
        scans: '++id, scanId, docNumber, travelerName, timestamp, riskScore, pathway, decision, auditHash',
        syncQueue: '++id, type, endpoint, payload, retryCount, createdAt, status',
        systemMeta: 'key, value, updatedAt'
      });

      // Schema Version 2: Complete On-Device Border Inspection Schema
      this.db.version(2).stores({
        // Preserved legacy tables
        blocks: '++id, index, hash, prevHash, docId, travelerName, nationality, timestamp, decision, syncStatus',
        travelers: 'docNumber, fullName, nationality, pathway, crossingCount, lastCrossing, riskLevel',
        syncQueue: '++id, type, endpoint, payload, retryCount, createdAt, status',
        systemMeta: 'key, value, updatedAt',

        // 1. Scans: one row per document scan
        scans: 'record_id, checkpoint_id, officer_id, timestamp, document_type, status',
        // 2. Extracted Fields: 1:1 with scans
        extracted_fields: 'record_id, name, date_of_birth, document_number, nationality, gender, issue_date, expiry_date',
        // 3. Validation Results: 1:1 with scans
        validation_results: 'record_id, mrz_checksum_passed, field_format_passed, date_logic_passed',
        // 4. Detection Scores: 1:1 with scans
        detection_scores: 'record_id, tamper_score, face_match_score, hidden_text_flag, risk_score, decision',
        // 5. Audit Log: hash-chain, append-only
        audit_log: '++entry_id, record_id, timestamp, officer_id, checkpoint_id, risk_score, decision, prior_hash, entry_hash, synced',
        // 6. Ledger Cache: local cache for fast-lane offline lookups
        ledger_cache: 'document_id, last_status, crossing_count, last_seen_timestamp, last_sync_timestamp'
      });

      // Schema Version 3: Add image_blobs table for offline JPEG storage
      // Images are stored as Blob objects directly in IndexedDB so captures
      // survive even when the backend is unreachable.
      this.db.version(3).stores({
        blocks: '++id, index, hash, prevHash, docId, travelerName, nationality, timestamp, decision, syncStatus',
        travelers: 'docNumber, fullName, nationality, pathway, crossingCount, lastCrossing, riskLevel',
        syncQueue: '++id, type, endpoint, payload, retryCount, createdAt, status',
        systemMeta: 'key, value, updatedAt',
        scans: 'record_id, checkpoint_id, officer_id, timestamp, document_type, status',
        extracted_fields: 'record_id, name, date_of_birth, document_number, nationality, gender, issue_date, expiry_date',
        validation_results: 'record_id, mrz_checksum_passed, field_format_passed, date_logic_passed',
        detection_scores: 'record_id, tamper_score, face_match_score, hidden_text_flag, risk_score, decision',
        audit_log: '++entry_id, record_id, timestamp, officer_id, checkpoint_id, risk_score, decision, prior_hash, entry_hash, synced',
        ledger_cache: 'document_id, last_status, crossing_count, last_seen_timestamp, last_sync_timestamp',
        // 7. Image Blobs: stores raw JPEG Blob + quality diagnostics per scan
        image_blobs: 'record_id, timestamp, size_bytes, quality_passed'
      });

      // Schema Version 4: Generic Extracted Fields across passport, national_id, visa
      this.db.version(4).stores({
        blocks: '++id, index, hash, prevHash, docId, travelerName, nationality, timestamp, decision, syncStatus',
        travelers: 'docNumber, fullName, nationality, pathway, crossingCount, lastCrossing, riskLevel',
        syncQueue: '++id, type, endpoint, payload, retryCount, createdAt, status',
        systemMeta: 'key, value, updatedAt',
        scans: 'record_id, checkpoint_id, officer_id, timestamp, document_type, status',
        extracted_fields: 'record_id, document_type, name, date_of_birth, document_number, nationality, gender, issue_date, expiry_date',
        validation_results: 'record_id, mrz_checksum_passed, field_format_passed, date_logic_passed',
        detection_scores: 'record_id, tamper_score, face_match_score, hidden_text_flag, risk_score, decision',
        audit_log: '++entry_id, record_id, timestamp, officer_id, checkpoint_id, risk_score, decision, prior_hash, entry_hash, synced',
        ledger_cache: 'document_id, last_status, crossing_count, last_seen_timestamp, last_sync_timestamp',
        image_blobs: 'record_id, timestamp, size_bytes, quality_passed'
      });

      // Schema Version 5: Add validation_passed to validation_results
      this.db.version(5).stores({
        blocks: '++id, index, hash, prevHash, docId, travelerName, nationality, timestamp, decision, syncStatus',
        travelers: 'docNumber, fullName, nationality, pathway, crossingCount, lastCrossing, riskLevel',
        syncQueue: '++id, type, endpoint, payload, retryCount, createdAt, status',
        systemMeta: 'key, value, updatedAt',
        scans: 'record_id, checkpoint_id, officer_id, timestamp, document_type, status',
        extracted_fields: 'record_id, document_type, name, date_of_birth, document_number, nationality, gender, issue_date, expiry_date',
        validation_results: 'record_id, validation_passed, mrz_checksum_passed, field_format_passed, date_logic_passed',
        detection_scores: 'record_id, tamper_score, face_match_score, hidden_text_flag, risk_score, decision',
        audit_log: '++entry_id, record_id, timestamp, officer_id, checkpoint_id, risk_score, decision, prior_hash, entry_hash, synced',
        ledger_cache: 'document_id, last_status, crossing_count, last_seen_timestamp, last_sync_timestamp',
        image_blobs: 'record_id, timestamp, size_bytes, quality_passed'
      });

      await this.db.open();
      this.isInitialized = true;
      if (typeof window !== 'undefined') {
        window.dbInstance = this;
        window.db = this.db;
      }
      console.log('[DocuShield DB] IndexedDB database initialized successfully via Dexie.js');

      // Check and request persistent storage (Step 0c)
      await this.verifyAndRequestPersistence();

      return this.db;
    } catch (err) {
      console.error('[DocuShield DB] Failed to initialize Dexie database:', err);
      // Resilient recovery for schema conflicts (e.g. across version upgrades)
      try {
        const DexieClass = window.Dexie || (typeof Dexie !== 'undefined' ? Dexie : null);
        if (DexieClass) {
          console.warn('[DocuShield DB] Attempting recovery by recreating Dexie database cleanly...');
          await DexieClass.delete('DocuShield_Border_DB');
          this.db = new DexieClass('DocuShield_Border_DB');
          this.db.version(3).stores({
            blocks: '++id, index, hash, prevHash, docId, travelerName, nationality, timestamp, decision, syncStatus',
            travelers: 'docNumber, fullName, nationality, pathway, crossingCount, lastCrossing, riskLevel',
            syncQueue: '++id, type, endpoint, payload, retryCount, createdAt, status',
            systemMeta: 'key, value, updatedAt',
            scans: 'record_id, checkpoint_id, officer_id, timestamp, document_type, status',
            extracted_fields: 'record_id, name, date_of_birth, document_number, nationality, gender, issue_date, expiry_date',
            validation_results: 'record_id, mrz_checksum_passed, field_format_passed, date_logic_passed',
            detection_scores: 'record_id, tamper_score, face_match_score, hidden_text_flag, risk_score, decision',
            audit_log: '++entry_id, record_id, timestamp, officer_id, checkpoint_id, risk_score, decision, prior_hash, entry_hash, synced',
            ledger_cache: 'document_id, last_status, crossing_count, last_seen_timestamp, last_sync_timestamp',
            image_blobs: 'record_id, timestamp, size_bytes, quality_passed'
          });
          await this.db.open();
          this.isInitialized = true;
          if (typeof window !== 'undefined') {
            window.dbInstance = this;
            window.db = this.db;
          }
          console.log('[DocuShield DB] Database recreated and initialized successfully.');
          return this.db;
        }
      } catch (recErr) {
        console.error('[DocuShield DB] Database recovery failed:', recErr);
      }
      return null;
    }
  }

  /**
   * Step 0c — Request persistent storage permission so IndexedDB data isn't
   * cleared by the browser under storage pressure.
   */
  async verifyAndRequestPersistence() {
    if (!navigator.storage) {
      console.warn('[DocuShield Storage] navigator.storage API not available in this browser');
      return { persisted: false, quota: 0, usage: 0 };
    }

    try {
      // 1. Check if already persisted
      let isPersisted = await navigator.storage.persisted();
      if (!isPersisted && navigator.storage.persist) {
        // Request persistent storage
        isPersisted = await navigator.storage.persist();
        console.log(`[DocuShield Storage] navigator.storage.persist() granted: ${isPersisted}`);
      } else {
        console.log(`[DocuShield Storage] Storage already persisted: ${isPersisted}`);
      }
      this.persisted = isPersisted;

      // 2. Query storage estimate
      if (navigator.storage.estimate) {
        const est = await navigator.storage.estimate();
        const quotaMB = Math.round((est.quota || 0) / (1024 * 1024));
        const usageMB = Math.round((est.usage || 0) / (1024 * 1024));
        const pct = est.quota ? Math.round(((est.usage || 0) / est.quota) * 100) : 0;
        this.storageEstimate = { quota: quotaMB, usage: usageMB, percentUsed: pct };
        console.log(`[DocuShield Storage] Storage Quota: ${quotaMB} MB, Used: ${usageMB} MB (${pct}%)`);
      }

      return {
        persisted: this.persisted,
        quota: this.storageEstimate.quota,
        usage: this.storageEstimate.usage
      };
    } catch (e) {
      console.warn('[DocuShield Storage] Error checking storage persistence:', e);
      return { persisted: false, quota: 0, usage: 0 };
    }
  }

  // --- BLOCKS (Cryptographic Hash-Chain) ---
  async addBlock(block) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.blocks.put(block);
    } catch (e) {
      console.error('[DocuShield DB] addBlock error:', e);
    }
  }

  async getAllBlocks() {
    await this.init();
    if (!this.db) return [];
    try {
      return await this.db.blocks.orderBy('index').toArray();
    } catch (e) {
      console.error('[DocuShield DB] getAllBlocks error:', e);
      return [];
    }
  }

  // --- TRAVELERS (Column C Fast-Lane & Crossing Counts) ---
  async getTraveler(docNumber) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.travelers.get(docNumber);
    } catch (e) {
      console.error('[DocuShield DB] getTraveler error:', e);
      return null;
    }
  }

  async saveTraveler(traveler) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.travelers.put(traveler);
    } catch (e) {
      console.error('[DocuShield DB] saveTraveler error:', e);
    }
  }

  // --- SCANS (Full Inspection Audits) ---
  async recordScan(scanRecord) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.scans.add(scanRecord);
    } catch (e) {
      console.error('[DocuShield DB] recordScan error:', e);
    }
  }

  // --- SYNC QUEUE (Offline Store-and-Forward) ---
  async enqueueSync(queueItem) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.syncQueue.add({
        ...queueItem,
        createdAt: new Date().toISOString(),
        status: 'PENDING',
        retryCount: 0
      });
    } catch (e) {
      console.error('[DocuShield DB] enqueueSync error:', e);
    }
  }

  async getPendingSync() {
    await this.init();
    if (!this.db) return [];
    try {
      return await this.db.syncQueue.where('status').equals('PENDING').toArray();
    } catch (e) {
      console.error('[DocuShield DB] getPendingSync error:', e);
      return [];
    }
  }

  async markSyncComplete(id) {
    await this.init();
    if (!this.db) return;
    try {
      await this.db.syncQueue.update(id, { status: 'COMPLETED', completedAt: new Date().toISOString() });
    } catch (e) {
      console.error('[DocuShield DB] markSyncComplete error:', e);
    }
  }

  // ============================================================
  // SPECIFICATION TABLES (On-Device Normalized Border Inspection)
  // ============================================================

  // 1. Table: scans (one row per document scan)
  /**
   * Step 2 — Store record in IndexedDB (via Dexie.js)
   * On pass, create a new record in IndexedDB (via Dexie.js) with fields:
   * record_id, image_blob, timestamp, status='captured'.
   * @param {Object} scan
   * @returns {Promise<Object|null>}
   */
  async saveScanRecord(scan) {
    await this.init();
    if (!this.db) return null;
    try {
      const record = {
        record_id: scan.record_id,
        image_blob: scan.image_blob || scan.blob || null,
        timestamp: scan.timestamp || new Date().toISOString(),
        status: scan.status || 'captured',
        checkpoint_id: scan.checkpoint_id || 'CP-04-NORTH',
        officer_id: scan.officer_id || 'SSB-OFFICER',
        image_path: scan.image_path || (scan.record_id ? `indexeddb://image_blobs/${scan.record_id}` : null),
        document_type: scan.document_type || 'passport'
      };
      await this.db.scans.put(record);
      console.log(`[DocuShield DB] ✅ Step 2: Record saved in IndexedDB (scans):`, {
        record_id: record.record_id,
        has_blob: Boolean(record.image_blob),
        timestamp: record.timestamp,
        status: record.status
      });
      return record;
    } catch (e) {
      console.error('[DocuShield DB] saveScanRecord error:', e);
      return null;
    }
  }

  /**
   * Step 2 convenience method:
   * Creates a new record in IndexedDB (via Dexie.js) with fields:
   * record_id, image_blob, timestamp, status='captured'
   */
  async createScanRecord(record_id, image_blob, options = {}) {
    await this.init();
    if (!this.db) return null;
    try {
      const record = {
        record_id,
        image_blob: image_blob || null,
        timestamp: options.timestamp || new Date().toISOString(),
        status: options.status || 'captured',
        checkpoint_id: options.checkpoint_id || 'CP-04-NORTH',
        officer_id: options.officer_id || 'SSB-OFFICER',
        image_path: options.image_path || `indexeddb://image_blobs/${record_id}`,
        document_type: options.document_type || 'passport'
      };
      await this.db.scans.put(record);
      if (image_blob) {
        await this.saveImageBlob(record_id, image_blob, options.qualityResult || {});
      }
      console.log(`[DocuShield DB] ✅ Step 2: Record created in IndexedDB (scans):`, {
        record_id: record.record_id,
        has_blob: Boolean(record.image_blob),
        timestamp: record.timestamp,
        status: record.status
      });
      return record;
    } catch (e) {
      console.error('[DocuShield DB] createScanRecord error:', e);
      return null;
    }
  }

  async getScanRecord(record_id) {
    await this.init();
    if (!this.db) return null;
    return await this.db.scans.get(record_id);
  }

  async updateScanStatus(record_id, status) {
    await this.init();
    if (!this.db) return null;
    return await this.db.scans.update(record_id, { status });
  }

  // 2. Table: extracted_fields (1:1 with scans) - Generic across passport, national_id, visa
  async saveExtractedFields(fields) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.extracted_fields.put({
        record_id: fields.record_id,
        document_type: fields.document_type || 'passport',
        name: fields.name || null,
        date_of_birth: fields.date_of_birth || null,
        document_number: fields.document_number || null,
        nationality: fields.nationality || null,
        gender: fields.gender || null,
        issue_date: fields.issue_date || null,
        expiry_date: fields.expiry_date || null,
        mrz_raw: fields.mrz_raw || null,
        extra_fields: typeof fields.extra_fields === 'object' && fields.extra_fields !== null
          ? JSON.stringify(fields.extra_fields)
          : (fields.extra_fields || null)
      });
    } catch (e) {
      console.error('[DocuShield DB] saveExtractedFields error:', e);
      return null;
    }
  }

  async getExtractedFields(record_id) {
    await this.init();
    if (!this.db) return null;
    return await this.db.extracted_fields.get(record_id);
  }

  // 3. Table: validation_results (1:1 with scans)
  async saveValidationResults(results) {
    await this.init();
    if (!this.db) return null;
    try {
      const isPassed = results.validation_passed !== undefined
        ? Boolean(results.validation_passed)
        : Boolean(results.mrz_checksum_passed !== false && results.field_format_passed !== false && results.date_logic_passed !== false);

      return await this.db.validation_results.put({
        record_id: results.record_id,
        validation_passed: isPassed,
        mrz_checksum_passed: Boolean(results.mrz_checksum_passed),
        field_format_passed: Boolean(results.field_format_passed),
        date_logic_passed: Boolean(results.date_logic_passed),
        photo_validation_passed: results.photo_validation_passed !== undefined ? Boolean(results.photo_validation_passed) : true,
        failure_reasons: typeof results.failure_reasons === 'string'
          ? results.failure_reasons
          : JSON.stringify(results.failure_reasons || [])
      });
    } catch (e) {
      console.error('[DocuShield DB] saveValidationResults error:', e);
      return null;
    }
  }

  async getValidationResults(record_id) {
    await this.init();
    if (!this.db) return null;
    return await this.db.validation_results.get(record_id);
  }

  /**
   * Step 5: Validates an 'ocr_done' record, computes validation results,
   * stores validation_passed and failure_reasons, and transitions status
   * to 'validated' or 'validation_failed' (never auto-denies).
   */
  async validateOcrRecord(record_id, validationData = {}) {
    await this.init();
    if (!this.db) return null;
    try {
      const mrzPassed = validationData.mrz_checksum_passed !== false;
      const formatPassed = validationData.field_format_passed !== false;
      const datePassed = validationData.date_logic_passed !== false;
      const photoPassed = validationData.photo_validation_passed !== false;

      const isValidationPassed = validationData.validation_passed !== undefined
        ? Boolean(validationData.validation_passed)
        : Boolean(mrzPassed && formatPassed && datePassed);

      const targetStatus = isValidationPassed ? 'validated' : 'validation_failed';
      await this.updateScanStatus(record_id, targetStatus);

      const valRecord = {
        record_id,
        validation_passed: isValidationPassed,
        mrz_checksum_passed: mrzPassed,
        field_format_passed: formatPassed,
        date_logic_passed: datePassed,
        photo_validation_passed: photoPassed,
        failure_reasons: typeof validationData.failure_reasons === 'string'
          ? validationData.failure_reasons
          : JSON.stringify(validationData.failure_reasons || [])
      };
      await this.saveValidationResults(valRecord);

      return {
        record_id,
        status: targetStatus,
        validation_passed: isValidationPassed,
        failure_reasons: valRecord.failure_reasons
      };
    } catch (e) {
      console.error('[DocuShield DB] validateOcrRecord error:', e);
      return null;
    }
  }

  // 4. Table: detection_scores (1:1 with scans)
  async saveDetectionScores(scores) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.detection_scores.put({
        record_id: scores.record_id,
        tamper_score: parseFloat(scores.tamper_score || 0),
        face_match_score: parseFloat(scores.face_match_score || 0),
        hidden_text_flag: Boolean(scores.hidden_text_flag),
        risk_score: parseFloat(scores.risk_score || 0),
        decision: scores.decision || 'needs_review'
      });
    } catch (e) {
      console.error('[DocuShield DB] saveDetectionScores error:', e);
      return null;
    }
  }

  async getDetectionScores(record_id) {
    await this.init();
    if (!this.db) return null;
    return await this.db.detection_scores.get(record_id);
  }

  // 5. Table: audit_log (hash-chain, append-only)
  async appendAuditLog(entry) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.audit_log.add({
        record_id: entry.record_id,
        timestamp: entry.timestamp || new Date().toISOString(),
        officer_id: entry.officer_id,
        checkpoint_id: entry.checkpoint_id,
        risk_score: parseFloat(entry.risk_score || 0),
        decision: entry.decision,
        prior_hash: entry.prior_hash,
        entry_hash: entry.entry_hash,
        synced: Boolean(entry.synced || false)
      });
    } catch (e) {
      console.error('[DocuShield DB] appendAuditLog error:', e);
      return null;
    }
  }

  async getUnsyncedAuditLogs() {
    await this.init();
    if (!this.db) return [];
    try {
      return await this.db.audit_log.where('synced').equals(0).or('synced').equals(false).toArray();
    } catch (e) {
      console.error('[DocuShield DB] getUnsyncedAuditLogs error:', e);
      return [];
    }
  }

  async markAuditLogsSynced(entry_ids) {
    await this.init();
    if (!this.db || !entry_ids || entry_ids.length === 0) return;
    try {
      for (const id of entry_ids) {
        await this.db.audit_log.update(id, { synced: true });
      }
    } catch (e) {
      console.error('[DocuShield DB] markAuditLogsSynced error:', e);
    }
  }

  // 6. Table: ledger_cache (local cache for fast-lane offline lookups)
  async getLedgerCache(document_id) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.ledger_cache.get(document_id);
    } catch (e) {
      console.error('[DocuShield DB] getLedgerCache error:', e);
      return null;
    }
  }

  async setLedgerCache(entry) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.ledger_cache.put({
        document_id: entry.document_id,
        last_status: entry.last_status || 'unknown',
        crossing_count: parseInt(entry.crossing_count || 0, 10),
        last_seen_timestamp: entry.last_seen_timestamp || new Date().toISOString(),
        last_sync_timestamp: entry.last_sync_timestamp || new Date().toISOString()
      });
    } catch (e) {
      console.error('[DocuShield DB] setLedgerCache error:', e);
      return null;
    }
  }

  // ============================================================
  // 7. Image Blobs: offline JPEG storage
  // ============================================================

  /**
   * Save a captured document image as a JPEG blob in IndexedDB.
   * @param {string} record_id - UUID linking to the scans table
   * @param {Blob} blob - JPEG Blob from canvas.toBlob()
   * @param {Object} qualityResult - QualityGate diagnostics snapshot
   * @returns {Promise<string|null>} record_id on success
   */
  async saveImageBlob(record_id, blob, qualityResult = {}) {
    await this.init();
    if (!this.db) return null;
    try {
      await this.db.image_blobs.put({
        record_id,
        image_blob: blob,
        blob,  // Dexie stores Blob objects natively in IndexedDB
        timestamp: new Date().toISOString(),
        status: 'captured',
        size_bytes: blob.size,
        quality_passed: qualityResult.passed ?? true,
        laplacian_variance: qualityResult.laplacianVariance ?? null,
        overexposed_pct: qualityResult.overexposedPct ?? null,
        framing_score: qualityResult.framingScore ?? null
      });
      console.log(`[DocuShield DB] ✅ Image blob saved locally: ${(blob.size / 1024).toFixed(1)} KB (${record_id})`);
      return record_id;
    } catch (e) {
      console.error('[DocuShield DB] saveImageBlob error:', e);
      return null;
    }
  }

  /**
   * Retrieve a stored image blob by record_id.
   * @param {string} record_id
   * @returns {Promise<Object|null>} { record_id, blob, timestamp, size_bytes, ... }
   */
  async getImageBlob(record_id) {
    await this.init();
    if (!this.db) return null;
    try {
      return await this.db.image_blobs.get(record_id);
    } catch (e) {
      console.error('[DocuShield DB] getImageBlob error:', e);
      return null;
    }
  }

  /**
   * Delete an image blob (e.g. after successful backend sync).
   * @param {string} record_id
   */
  async deleteImageBlob(record_id) {
    await this.init();
    if (!this.db) return;
    try {
      await this.db.image_blobs.delete(record_id);
    } catch (e) {
      console.error('[DocuShield DB] deleteImageBlob error:', e);
    }
  }

  /**
   * Count how many image blobs are stored locally (for storage HUD).
   * @returns {Promise<number>}
   */
  async countImageBlobs() {
    await this.init();
    if (!this.db) return 0;
    try {
      return await this.db.image_blobs.count();
    } catch (e) {
      return 0;
    }
  }
}

export const dbInstance = new LocalDatabaseManager();
