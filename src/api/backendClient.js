/**
 * DocuShield Backend API Client
 * Sends scan results, images, and decisions to the FastAPI/SQLite backend.
 * Falls back gracefully when backend is unreachable (offline-first).
 */

const API_BASE = 'http://localhost:8000/api';

export class BackendAPI {
  /**
   * Check if backend is reachable
   */
  static async isAvailable() {
    try {
      const resp = await fetch(`${API_BASE}/health`, { 
        method: 'GET',
        signal: AbortSignal.timeout(3000) 
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
        signal: AbortSignal.timeout(15000),
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
        signal: AbortSignal.timeout(10000),
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
        signal: AbortSignal.timeout(10000),
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
        signal: AbortSignal.timeout(5000),
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
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Dashboard stats failed:', err.message);
    }
    return null;
  }

  /**
   * Get audit log from database.
   */
  static async getAuditLog(limit = 100) {
    try {
      const resp = await fetch(`${API_BASE}/audit?limit=${limit}`, {
        signal: AbortSignal.timeout(5000),
      });
      if (resp.ok) return await resp.json();
    } catch (err) {
      console.warn('[API] Audit log failed:', err.message);
    }
    return null;
  }
}
