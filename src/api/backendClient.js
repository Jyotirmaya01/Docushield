/**
 * DocuShield Backend API Client
 * Sends scan results, images, and decisions to the FastAPI/SQLite backend.
 * Falls back gracefully when backend is unreachable (offline-first).
 */

export function safeTimeoutSignal(ms = 3000) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    try {
      return AbortSignal.timeout(ms);
    } catch {}
  }
  const controller = new AbortController();
  setTimeout(() => {
    try { controller.abort(); } catch {}
  }, ms);
  return controller.signal;
}

export function getApiBase() {
  if (typeof window === 'undefined') return 'http://127.0.0.1:8000/api';
  const protocol = window.location?.protocol || 'http:';
  const hostname = window.location?.hostname || '127.0.0.1';
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '0.0.0.0';

  // If app is served over HTTPS (e.g. Vercel deployment), browsers block plain HTTP requests (Mixed Content)
  if (protocol === 'https:' && !isLocal) {
    return null;
  }

  const host = isLocal ? '127.0.0.1' : hostname;
  return `http://${host}:8000/api`;
}

const API_BASE = getApiBase();

export class BackendAPI {
  /**
   * Check if backend is reachable
   */
  static async isAvailable() {
    const base = getApiBase();
    if (!base) return false;
    try {
      const resp = await fetch(`${base}/health`, { 
        method: 'GET',
        signal: safeTimeoutSignal(1200) 
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Send a completed scan to the backend for SQLite storage.
   * Captures the document image from canvas as JPEG and sends it along with scan data.
   * 
   * @param {Object} scanData - Traveler info, MRZ data, etc.
   * @param {HTMLCanvasElement|null} canvas - The camera canvas to capture JPEG from
   * @returns {Promise<Object>} Backend response or null if offline
   */
  static async saveScan(scanData, canvas = null) {
    try {
      const formData = new FormData();

      // Generate a unique scan ID
      const scanId = crypto.randomUUID ? crypto.randomUUID() : 
        'scan-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);

      // Prepare scan data payload
      const payload = {
        scan_id: scanId,
        traveler_name: scanData.traveler?.fullName || scanData.visualFields?.fullName || 'UNKNOWN',
        nationality: scanData.traveler?.nationality || scanData.visualFields?.nationality || null,
        date_of_birth: scanData.traveler?.dateOfBirth || scanData.visualFields?.dateOfBirth || null,
        sex: scanData.traveler?.sex || scanData.visualFields?.sex || null,
        document_number: scanData.traveler?.documentNumber || scanData.visualFields?.documentNumber || null,
        document_type: scanData.traveler?.documentType || scanData.visualFields?.documentType || 'PASSPORT',
        expiry_date: scanData.traveler?.expiryDate || scanData.visualFields?.expiryDate || null,
        mrz_line_1: scanData.mrzLines?.[0] || null,
        mrz_line_2: scanData.mrzLines?.[1] || null,
        checkpoint_id: 'CP-04-NORTH',
        officer_id: 'SSB-7489-N',
        sync_status: 'SYNCED',
      };

      // If we have a canvas, capture it as JPEG
      if (canvas) {
        try {
          const blob = await new Promise((resolve) => {
            canvas.toBlob(resolve, 'image/jpeg', 0.85);
          });
          if (blob) {
            formData.append('document_image', blob, `scan_${scanId}.jpg`);
            console.log(`[API] Document image captured: ${(blob.size / 1024).toFixed(1)} KB JPEG`);
          }
        } catch (err) {
          console.warn('[API] Canvas to JPEG failed:', err);
        }
      }

      // If no canvas image but we have a photo URL, send it as base64
      if (!canvas && scanData.photoUrl && scanData.photoUrl.startsWith('data:')) {
        payload.image_base64 = scanData.photoUrl;
      }

      formData.append('scan_data', JSON.stringify(payload));

      const resp = await fetch(`${API_BASE}/scans`, {
        method: 'POST',
        body: formData,
        signal: safeTimeoutSignal(15000),
      });

      if (!resp.ok) {
        const error = await resp.text();
        console.error('[API] Scan save failed:', resp.status, error);
        return null;
      }

      const result = await resp.json();
      console.log('[API] ✅ Scan saved to SQLite:', result.scan?.scan_id);
      return { ...result, scan_id: scanId };
    } catch (err) {
      console.warn('[API] Backend unreachable, scan stored locally only:', err.message);
      return null;
    }
  }

  /**
   * Send pipeline analysis results to backend.
   * 
   * @param {string} scanId - The scan UUID
   * @param {Object} analysisResult - Full pipeline result from ForensicEngine
   * @param {number} processingTimeMs - How long the pipeline took
   */
  static async saveAnalysis(scanId, analysisResult, processingTimeMs = 0) {
    try {
      const payload = {
        risk_score: analysisResult.riskScore || 0,
        confidence: analysisResult.confidence || 100,
        quality_gate: analysisResult.stages?.quality || null,
        ocr_result: analysisResult.stages?.ocr || null,
        mrz_validation: analysisResult.stages?.mrz || null,
        field_consistency: analysisResult.stages?.consistency || null,
        chronology_logic: analysisResult.stages?.logic || null,
        tamper_detection: analysisResult.stages?.tamper || null,
        face_match: analysisResult.stages?.face || null,
        injection_defense: analysisResult.stages?.injection || null,
        anomalies: analysisResult.anomalies || [],
        processing_time_ms: processingTimeMs,
      };

      const resp = await fetch(`${API_BASE}/scans/${scanId}/analysis`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: safeTimeoutSignal(10000),
      });

      if (resp.ok) {
        console.log('[API] ✅ Analysis results saved to SQLite');
        return await resp.json();
      }
    } catch (err) {
      console.warn('[API] Analysis save failed (offline):', err.message);
    }
    return null;
  }

  /**
   * Send structured OCR extracted fields to backend SQLite.
   * Step 4: Generic across passport, national_id, and visa.
   * 
   * @param {string} scanId - The scan UUID
   * @param {Object} fieldsData - Structured fields (name, date_of_birth, document_number, nationality, gender, issue_date, expiry_date, mrz_raw, extra_fields)
   */
  static async saveExtractedFields(scanId, fieldsData) {
    try {
      const payload = {
        record_id: scanId,
        document_type: fieldsData.document_type || fieldsData.documentType || 'passport',
        name: fieldsData.name || fieldsData.fullName || null,
        date_of_birth: fieldsData.date_of_birth || fieldsData.dateOfBirth || null,
        document_number: fieldsData.document_number || fieldsData.documentNumber || null,
        nationality: fieldsData.nationality || null,
        gender: fieldsData.gender || fieldsData.sex || null,
        issue_date: fieldsData.issue_date || fieldsData.issueDate || null,
        expiry_date: fieldsData.expiry_date || fieldsData.expiryDate || null,
        mrz_raw: fieldsData.mrz_raw || null,
        extra_fields: fieldsData.extra_fields || fieldsData.extraFields || {}
      };

      const resp = await fetch(`${API_BASE}/scans/${scanId}/extracted-fields`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: safeTimeoutSignal(10000),
      });

      if (resp.ok) {
        const result = await resp.json();
        console.log('[API] ✅ Step 4: Structured OCR fields saved to SQLite for scan:', scanId);
        return result;
      } else {
        const errText = await resp.text();
        console.warn('[API] Extracted fields save rejected by SQLite:', resp.status, errText);
      }
    } catch (err) {
      console.warn('[API] Extracted fields save failed (offline):', err.message);
    }
    return null;
  }

  /**
   * Retrieve structured OCR extracted fields for a scan from backend SQLite.
   * @param {string} scanId
   * @returns {Promise<Object|null>}
   */
  static async getExtractedFields(scanId) {
    try {
      const resp = await fetch(`${API_BASE}/scans/${scanId}/extracted-fields`, {
        signal: safeTimeoutSignal(5000),
      });
      if (resp.ok) {
        const result = await resp.json();
        return result.extracted_fields || null;
      }
    } catch (err) {
      console.warn('[API] Get extracted fields failed (offline):', err.message);
    }
    return null;
  }

  /**
   * Record an officer decision to backend.
   * 
   * @param {string} scanId - The scan UUID
   * @param {Object} decisionData - { decision, officer_notes, reasons, ledger_block_index, ledger_hash }
   */
  static async saveDecision(scanId, decisionData) {
    try {
      const resp = await fetch(`${API_BASE}/scans/${scanId}/decision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          decision: decisionData.decision,
          officer_id: decisionData.officer_id || 'SSB-7489-N',
          officer_notes: decisionData.officer_notes || null,
          reasons: decisionData.reasons || [],
          ledger_block_index: decisionData.ledger_block_index || null,
          ledger_hash: decisionData.ledger_hash || null,
          risk_score: decisionData.risk_score || null,
        }),
        signal: safeTimeoutSignal(10000),
      });

      if (resp.ok) {
        console.log('[API] ✅ Decision saved to SQLite:', decisionData.decision);
        return await resp.json();
      }
    } catch (err) {
      console.warn('[API] Decision save failed (offline):', err.message);
    }
    return null;
  }

  /**
   * Get all scans from the database.
   */
  static async getScans(limit = 50) {
    try {
      const resp = await fetch(`${API_BASE}/scans?limit=${limit}`, {
        signal: safeTimeoutSignal(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Get scans failed:', err.message);
    }
    return null;
  }

  /**
   * Get document image URL for a scan.
   */
  static getImageUrl(scanId) {
    return `${API_BASE}/scans/${scanId}/image`;
  }

  /**
   * Get dashboard statistics.
   */
  static async getDashboardStats() {
    try {
      const resp = await fetch(`${API_BASE}/dashboard/stats`, {
        signal: safeTimeoutSignal(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Dashboard stats failed:', err.message);
    }
    return null;
  }

  /**
   * Officer / Admin Authentication
   */
  static async login(officerId, password) {
    try {
      const resp = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ officer_id: officerId, password: password }),
        signal: safeTimeoutSignal(5000),
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch (err) {
      console.warn('[API] Login request failed:', err.message);
      return null;
    }
  }

  /**
   * Batch Audit Log Sync with Tamper-Evident Hash Verification
   * Rejects images centrally; sends only lightweight metadata and hash-chain records.
   */
  static async syncAuditLog(entries, sessionToken = null) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const resp = await fetch(`${API_BASE}/sync/audit-log`, {
        method: 'POST',
        headers,
        body: JSON.stringify(entries),
        signal: safeTimeoutSignal(10000),
      });
      return { ok: resp.ok, status: resp.status, data: await resp.json() };
    } catch (err) {
      console.warn('[API] Sync audit log failed:', err.message);
      return { ok: false, error: err.message };
    }
  }

  /**
   * Fast-lane Central Frequent-Crosser Lookup
   */
  static async lookupLedger(documentId, sessionToken = null) {
    try {
      const headers = {};
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const resp = await fetch(`${API_BASE}/ledger/lookup?document_id=${encodeURIComponent(documentId)}`, {
        headers,
        signal: safeTimeoutSignal(4000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Ledger lookup failed (will rely on local hash-chain):', err.message);
    }
    return null;
  }

  /**
   * Update Central Frequent-Crosser Ledger after finalized decision
   */
  static async updateLedger(payload, sessionToken = null) {
    try {
      const headers = { 'Content-Type': 'application/json' };
      if (sessionToken) headers['Authorization'] = `Bearer ${sessionToken}`;

      const resp = await fetch(`${API_BASE}/ledger/update`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: safeTimeoutSignal(6000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Ledger update failed (will sync later):', err.message);
    }
    return null;
  }

  /**
   * Checkpoint Audit Log Query (Officer scope: assigned checkpoint)
   */
  static async getAuditLogByCheckpoint(checkpointId, sessionToken, limit = 50) {
    try {
      const resp = await fetch(`${API_BASE}/audit-log?checkpoint_id=${encodeURIComponent(checkpointId)}&limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        signal: safeTimeoutSignal(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Get checkpoint audit log failed:', err.message);
    }
    return null;
  }

  /**
   * Global Audit Log Query across all checkpoints (Admin access only)
   */
  static async getAllAuditLogs(sessionToken, limit = 100) {
    try {
      const resp = await fetch(`${API_BASE}/audit-log/all?limit=${limit}`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        signal: safeTimeoutSignal(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Get all audit logs failed:', err.message);
    }
    return null;
  }

  /**
   * List all registered checkpoints (Admin)
   */
  static async getCheckpoints(sessionToken) {
    try {
      const resp = await fetch(`${API_BASE}/checkpoints`, {
        headers: { 'Authorization': `Bearer ${sessionToken}` },
        signal: safeTimeoutSignal(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Get checkpoints failed:', err.message);
    }
    return null;
  }

  /**
   * Register a new checkpoint (Admin)
   */
  static async createCheckpoint(checkpointData, sessionToken) {
    try {
      const resp = await fetch(`${API_BASE}/checkpoints`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionToken}`,
        },
        body: JSON.stringify(checkpointData),
        signal: safeTimeoutSignal(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Create checkpoint failed:', err.message);
    }
    return null;
  }
}
