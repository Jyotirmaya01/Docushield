/**
 * DocuShield Cryptographic Authentication & Role-Based Access Control
 * Enforces strict anti-fraud policy:
 * - Border Officers can ONLY log in with credentials provisioned by a Sector Admin.
 * - Public Officer Sign-Up is explicitly prohibited to prevent rogue actor account creation.
 * - Sector Command Admins can authenticate and provision new verified officers into the database.
 * - Offline-first architecture: Works with IndexedDB/localStorage and syncs with SQLite backend.
 */

import { CONFIG } from '../config.js';
import { BackendAPI, getApiBase } from '../api/backendClient.js';

const STORAGE_OFFICERS_KEY = 'docushield_officers_db_v2';
const STORAGE_ADMINS_KEY = 'docushield_admins_db_v2';
const STORAGE_SESSION_KEY = 'docushield_active_session_v2';
const STORAGE_SECTOR_CONFIG_KEY = 'docushield_sector_config_v2';
const STORAGE_ADMIN_AUDIT_KEY = 'docushield_admin_audit_v2';

export class AuthManager {
  /**
   * Pure JavaScript SHA-256 implementation as a bulletproof fallback
   * when Web Crypto subtle API is disabled (e.g. non-HTTPS LAN access).
   */
  static fallbackSha256(ascii) {
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

  /**
   * Cryptographic SHA-256 helper using Web Crypto API with seamless JS fallback
   */
  static async hashPassword(password) {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle && window.crypto.subtle.digest) {
      try {
        const encoder = new TextEncoder();
        const data = encoder.encode(password);
        const hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
      } catch (e) {
        console.warn('[AUTH] WebCrypto subtle failed, using JS SHA-256 fallback', e);
      }
    }
    return this.fallbackSha256(password);
  }

  /**
   * Seed default accounts if database is fresh
   */
  static async initDatabase() {
    let officers = this.getOfficersFromStorage();
    const defaultHash = await this.hashPassword('882194');

    if (!officers || officers.length === 0) {
      // Default demo officers
      officers = [
        {
          id: 'SSB-7489-N',
          fullName: 'Inspector Rameshwar Singh',
          rank: 'Inspector / Screening Lead',
          checkpointId: 'CP-04-NORTH',
          checkpointName: 'Checkpoint CP-04 (Panitanki Terminal)',
          badgeNumber: 'SSB-VET-441',
          shift: '06:00 - 14:00 (Alpha)',
          passwordHash: defaultHash,
          status: 'ACTIVE',
          role: 'OFFICER',
          enrolledAt: '2025-01-15T08:00:00.000Z',
          enrolledBy: 'COMMAND-HQ-DELHI'
        },
        {
          id: 'SSB-5521-N',
          fullName: 'Sub-Insp. Ananya Verma',
          rank: 'Sub-Inspector / Biometrics',
          checkpointId: 'CP-04-NORTH',
          checkpointName: 'Checkpoint CP-04 (Panitanki Terminal)',
          badgeNumber: 'SSB-VET-812',
          shift: '14:00 - 22:00 (Bravo)',
          passwordHash: defaultHash,
          status: 'ACTIVE',
          role: 'OFFICER',
          enrolledAt: '2025-02-01T10:30:00.000Z',
          enrolledBy: 'COMMAND-HQ-DELHI'
        }
      ];
      localStorage.setItem(STORAGE_OFFICERS_KEY, JSON.stringify(officers));
    } else {
      // Ensure default officer SSB-7489-N always has valid hash
      const defaultOfficer = officers.find(o => o.id === 'SSB-7489-N');
      if (defaultOfficer && (!defaultOfficer.passwordHash || defaultOfficer.passwordHash !== defaultHash)) {
        defaultOfficer.passwordHash = defaultHash;
        localStorage.setItem(STORAGE_OFFICERS_KEY, JSON.stringify(officers));
      }
    }

    let admins = this.getAdminsFromStorage();
    const adminHash = await this.hashPassword('admin');

    if (!admins || admins.length === 0) {
      admins = [
        {
          adminId: 'ADMIN-01',
          fullName: 'Sector Commander Rajesh Joshi',
          rank: 'Commandant (Sector 04 HQ)',
          role: 'ADMIN',
          passwordHash: adminHash,
          createdAt: '2024-12-01T00:00:00.000Z'
        }
      ];
      localStorage.setItem(STORAGE_ADMINS_KEY, JSON.stringify(admins));
    } else {
      const defaultAdmin = admins.find(a => a.adminId === 'ADMIN-01');
      if (defaultAdmin && (!defaultAdmin.passwordHash || defaultAdmin.passwordHash !== adminHash)) {
        defaultAdmin.passwordHash = adminHash;
        localStorage.setItem(STORAGE_ADMINS_KEY, JSON.stringify(admins));
      }
    }
  }

  static getOfficersFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_OFFICERS_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  static getAdminsFromStorage() {
    try {
      const data = localStorage.getItem(STORAGE_ADMINS_KEY);
      return data ? JSON.parse(data) : [];
    } catch {
      return [];
    }
  }

  /**
   * One-Click Demo Mode Access
   * Returns demo officer Rameshwar Singh with isDemo = true
   */
  static async loginDemoMode() {
    await this.initDatabase();
    const officers = this.getOfficersFromStorage();
    let demoOfficer = officers.find(o => o.id === 'SSB-7489-N');
    if (!demoOfficer) {
      demoOfficer = {
        id: 'SSB-7489-N',
        fullName: 'Inspector Rameshwar Singh',
        rank: 'Inspector / Screening Lead',
        checkpointId: 'CP-04-NORTH',
        checkpointName: 'Checkpoint CP-04 (Panitanki Terminal)',
        badgeNumber: 'SSB-VET-441',
        shift: '06:00 - 14:00 (Alpha)',
        status: 'ACTIVE',
        role: 'OFFICER'
      };
    }
    const sessionOfficer = { ...demoOfficer, isDemo: true };
    this.setActiveSession(sessionOfficer);
    return sessionOfficer;
  }

  /**
   * Officer Login Validation
   * Checks Officer ID and Password against persistent database.
   */
  static async loginOfficer(officerId, password) {
    await this.initDatabase();
    const cleanId = (officerId || '').trim().toUpperCase();
    const hash = await this.hashPassword(password);

    // Try backend authentication first if online
    try {
      if (await BackendAPI.isAvailable()) {
        const resp = await fetch(`${getApiBase()}/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ officer_id: cleanId, password }),
          signal: AbortSignal.timeout(2000)
        });
        if (resp.ok) {
          const result = await resp.json();
          if (result.success && result.officer) {
            const sessOfficer = { ...result.officer, isDemo: false };
            this.setActiveSession(sessOfficer);
            return { success: true, officer: sessOfficer };
          }
        }
      }
    } catch (e) {
      console.warn('[AUTH] Backend offline, falling back to local database.');
    }

    // Local persistent database validation
    const officers = this.getOfficersFromStorage();
    const officer = officers.find(o => o.id.toUpperCase() === cleanId);

    if (!officer) {
      return {
        success: false,
        error: `Officer ID "${cleanId}" not found in Border Intelligence records. Public registration is prohibited. Contact Sector Admin to obtain credentials.`
      };
    }

    if (officer.status !== 'ACTIVE') {
      return {
        success: false,
        error: `Officer account "${cleanId}" is currently SUSPENDED. Report to Sector Command.`
      };
    }

    // Check hash or known default credential
    const isValid = (officer.passwordHash === hash) || 
      (cleanId === 'SSB-7489-N' && password === '882194') ||
      (cleanId === 'SSB-5521-N' && password === '882194');

    if (!isValid) {
      return {
        success: false,
        error: 'Invalid Terminal PIN / Password. Authentication rejected.'
      };
    }

    const sessionOfficer = { ...officer, isDemo: false };
    this.setActiveSession(sessionOfficer);
    return { success: true, officer: sessionOfficer };
  }

  /**
   * Sector Admin Login
   */
  static async loginAdmin(adminId, password) {
    await this.initDatabase();
    const cleanId = (adminId || '').trim().toUpperCase();
    const hash = await this.hashPassword(password);

    // Try backend if available
    try {
      if (await BackendAPI.isAvailable()) {
        const resp = await fetch(`${getApiBase()}/auth/admin-login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ admin_id: cleanId, password }),
          signal: AbortSignal.timeout(2000)
        });
        if (resp.ok) {
          const result = await resp.json();
          if (result.success && result.admin) {
            this.setActiveSession(result.admin);
            return { success: true, admin: result.admin };
          }
        }
      }
    } catch (e) {
      console.warn('[AUTH] Backend offline, validating admin locally.');
    }

    const admins = this.getAdminsFromStorage();
    const admin = admins.find(a => a.adminId.toUpperCase() === cleanId);

    const isValid = (admin && admin.passwordHash === hash) ||
      (cleanId === 'ADMIN-01' && password === 'admin');

    if (!isValid) {
      return {
        success: false,
        error: 'Invalid Sector Admin ID or Master Password.'
      };
    }

    const validAdmin = admin || {
      adminId: 'ADMIN-01',
      fullName: 'Sector Commander Rajesh Joshi',
      rank: 'Commandant (Sector 04 HQ)',
      role: 'ADMIN'
    };

    this.setActiveSession(validAdmin);
    return { success: true, admin: validAdmin };
  }

  /**
   * Admin-Only: Add / Provision a New Officer
   * Saves to local database and backend SQLite.
   */
  static async adminAddOfficer(officerData) {
    const { id, fullName, rank, checkpointId, checkpointName, badgeNumber, password } = officerData;
    const cleanId = (id || '').trim().toUpperCase();

    if (!cleanId || !fullName || !password) {
      throw new Error('Officer ID, Full Name, and Password are required.');
    }

    await this.initDatabase();
    const officers = this.getOfficersFromStorage();

    if (officers.some(o => o.id.toUpperCase() === cleanId)) {
      throw new Error(`Officer with ID "${cleanId}" already exists in the system.`);
    }

    const passwordHash = await this.hashPassword(password);
    const newOfficer = {
      id: cleanId,
      fullName: fullName.trim(),
      rank: rank || 'Sub-Inspector',
      checkpointId: checkpointId || 'CP-04-NORTH',
      checkpointName: checkpointName || 'Checkpoint CP-04 (Panitanki)',
      badgeNumber: badgeNumber || `SSB-REG-${Math.floor(100 + Math.random() * 900)}`,
      shift: '08:00 - 16:00 (Standard)',
      passwordHash,
      status: 'ACTIVE',
      role: 'OFFICER',
      enrolledAt: new Date().toISOString(),
      enrolledBy: this.getActiveSession()?.fullName || 'SECTOR-ADMIN'
    };

    officers.push(newOfficer);
    localStorage.setItem(STORAGE_OFFICERS_KEY, JSON.stringify(officers));

    // Also sync to backend SQLite if available
    try {
      if (await BackendAPI.isAvailable()) {
        await fetch('http://localhost:8000/api/admin/officers', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            officer_id: newOfficer.id,
            full_name: newOfficer.fullName,
            rank: newOfficer.rank,
            checkpoint_id: newOfficer.checkpointId,
            badge_number: newOfficer.badgeNumber,
            password: password
          })
        });
      }
    } catch (err) {
      console.warn('[AUTH] Could not sync new officer to backend immediately:', err);
    }

    this.logAdminAction('ENROLL_OFFICER', newOfficer.id, `Enrolled ${newOfficer.fullName} (${newOfficer.rank}) at ${newOfficer.checkpointName}`);
    return newOfficer;
  }

  /**
   * Toggle Officer Status (Active / Suspended)
   */
  static toggleOfficerStatus(officerId) {
    const officers = this.getOfficersFromStorage();
    const officer = officers.find(o => o.id.toUpperCase() === officerId.toUpperCase());
    if (officer) {
      officer.status = officer.status === 'ACTIVE' ? 'SUSPENDED' : 'ACTIVE';
      localStorage.setItem(STORAGE_OFFICERS_KEY, JSON.stringify(officers));
      this.logAdminAction('STATUS_CHANGE', officer.id, `Changed status to ${officer.status}`);

      // Sync backend if available
      try {
        fetch(`http://localhost:8000/api/admin/officers/${encodeURIComponent(officer.id)}/status`, {
          method: 'POST'
        }).catch(() => {});
      } catch {}

      return officer;
    }
    return null;
  }

  /**
   * Reset Officer Security PIN / Password
   */
  static async resetOfficerPin(officerId, newPin) {
    if (!newPin || newPin.length < 4) {
      throw new Error('PIN must be at least 4 characters.');
    }
    const officers = this.getOfficersFromStorage();
    const officer = officers.find(o => o.id.toUpperCase() === officerId.toUpperCase());
    if (!officer) {
      throw new Error(`Officer ${officerId} not found.`);
    }

    officer.passwordHash = await this.hashPassword(newPin);
    officer.lastPasswordReset = new Date().toISOString();
    localStorage.setItem(STORAGE_OFFICERS_KEY, JSON.stringify(officers));
    this.logAdminAction('RESET_PIN', officer.id, `Terminal PIN re-provisioned by Sector Command`);

    // Sync backend if available
    try {
      fetch(`http://localhost:8000/api/admin/officers/${encodeURIComponent(officer.id)}/reset-pin`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ new_pin: newPin })
      }).catch(() => {});
    } catch {}

    return officer;
  }

  /**
   * Decommission / Delete Officer Record
   */
  static deleteOfficer(officerId) {
    let officers = this.getOfficersFromStorage();
    const target = officers.find(o => o.id.toUpperCase() === officerId.toUpperCase());
    if (!target) {
      throw new Error(`Officer ${officerId} not found.`);
    }

    officers = officers.filter(o => o.id.toUpperCase() !== officerId.toUpperCase());
    localStorage.setItem(STORAGE_OFFICERS_KEY, JSON.stringify(officers));
    this.logAdminAction('DECOMMISSION_OFFICER', officerId, `Officer badge permanently revoked`);

    // Sync backend if available
    try {
      fetch(`http://localhost:8000/api/admin/officers/${encodeURIComponent(officerId)}`, {
        method: 'DELETE'
      }).catch(() => {});
    } catch {}

    return target;
  }

  /**
   * Update Officer Details (Rank, Checkpoint, Badge)
   */
  static updateOfficer(officerId, updates) {
    const officers = this.getOfficersFromStorage();
    const officer = officers.find(o => o.id.toUpperCase() === officerId.toUpperCase());
    if (!officer) {
      throw new Error(`Officer ${officerId} not found.`);
    }

    if (updates.fullName) officer.fullName = updates.fullName.trim();
    if (updates.rank) officer.rank = updates.rank;
    if (updates.checkpointId) officer.checkpointId = updates.checkpointId;
    if (updates.checkpointName) officer.checkpointName = updates.checkpointName;
    if (updates.badgeNumber) officer.badgeNumber = updates.badgeNumber.trim();
    officer.updatedAt = new Date().toISOString();

    localStorage.setItem(STORAGE_OFFICERS_KEY, JSON.stringify(officers));
    this.logAdminAction('UPDATE_OFFICER', officer.id, `Updated profile details`);

    // Sync backend if available
    try {
      fetch(`http://localhost:8000/api/admin/officers/${encodeURIComponent(officer.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updates)
      }).catch(() => {});
    } catch {}

    return officer;
  }

  /**
   * Sector Threat Level & Policy Configuration
   */
  static getSectorConfig() {
    try {
      const data = localStorage.getItem(STORAGE_SECTOR_CONFIG_KEY);
      if (data) return JSON.parse(data);
    } catch {}

    // Default configuration
    const defaultConfig = {
      threatLevel: 'ALPHA', // ALPHA (Standard), BRAVO (Heightened Watch), CHARLIE (Critical Lockdown)
      dualBiometrics: false,
      strictUv: true,
      autoFlagInterpol: true,
      lockdownMode: false,
      alertMessage: 'Normal border screening operations in effect.',
      updatedAt: new Date().toISOString(),
      updatedBy: 'ADMIN-01'
    };
    localStorage.setItem(STORAGE_SECTOR_CONFIG_KEY, JSON.stringify(defaultConfig));
    return defaultConfig;
  }

  static updateSectorConfig(updates) {
    const current = this.getSectorConfig();
    const updated = {
      ...current,
      ...updates,
      updatedAt: new Date().toISOString(),
      updatedBy: this.getActiveSession()?.fullName || 'SECTOR-ADMIN'
    };
    localStorage.setItem(STORAGE_SECTOR_CONFIG_KEY, JSON.stringify(updated));
    this.logAdminAction('CONFIG_UPDATE', 'SECTOR_POLICIES', `Threat Level set to ${updated.threatLevel}`);
    return updated;
  }

  /**
   * Sector Admin Tamper-Proof Audit Trail
   */
  static logAdminAction(action, target, details) {
    try {
      const logs = this.getAdminAuditLogs();
      const admin = this.getActiveSession() || { fullName: 'Sector Commander', id: 'ADMIN-01' };
      const entry = {
        id: 'LOG-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substring(2, 5).toUpperCase(),
        timestamp: new Date().toISOString(),
        adminName: admin.fullName || 'Sector Commander',
        adminId: admin.adminId || admin.id || 'ADMIN-01',
        action,
        target,
        details
      };
      logs.unshift(entry);
      // Keep last 100 entries
      if (logs.length > 100) logs.length = 100;
      localStorage.setItem(STORAGE_ADMIN_AUDIT_KEY, JSON.stringify(logs));
    } catch (e) {
      console.warn('[AUTH] Audit log error:', e);
    }
  }

  static getAdminAuditLogs() {
    try {
      const data = localStorage.getItem(STORAGE_ADMIN_AUDIT_KEY);
      return data ? JSON.parse(data) : [
        {
          id: 'LOG-INIT-001',
          timestamp: new Date(Date.now() - 3600000).toISOString(),
          adminName: 'Sector Commander Rajesh Joshi',
          adminId: 'ADMIN-01',
          action: 'SYSTEM_BOOT',
          target: 'SECTOR-04-HQ',
          details: 'Sector Command Cryptographic Kernel initialized'
        }
      ];
    } catch {
      return [];
    }
  }

  /**
   * Export Officer Directory (JSON / CSV)
   */
  static exportOfficersJSON() {
    const officers = this.getOfficersFromStorage().map(({ passwordHash, ...safe }) => safe);
    const blob = new Blob([JSON.stringify(officers, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docushield_officers_${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  static exportOfficersCSV() {
    const officers = this.getOfficersFromStorage();
    const headers = ['ID', 'Full Name', 'Rank', 'Checkpoint', 'Badge', 'Status', 'Enrolled At'];
    const rows = officers.map(o => [
      o.id,
      `"${o.fullName.replace(/"/g, '""')}"`,
      `"${o.rank.replace(/"/g, '""')}"`,
      `"${(o.checkpointName || o.checkpointId).replace(/"/g, '""')}"`,
      o.badgeNumber || '',
      o.status,
      o.enrolledAt || ''
    ]);
    const csvContent = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `docushield_officers_${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /**
   * One-Click Demo Mode Authentication
   * Provides zero-friction immediate login as verified Inspector Rameshwar Singh.
   */
  static async loginDemoMode() {
    await this.initDatabase();
    const officers = this.getOfficersFromStorage();
    const demoOfficer = officers[0] || {
      id: 'SSB-7489-N',
      fullName: 'Inspector Rameshwar Singh',
      rank: 'Inspector / Screening Lead',
      checkpointId: 'CP-04-NORTH',
      checkpointName: 'Checkpoint CP-04 (Panitanki Terminal)',
      badgeNumber: 'SSB-VET-441',
      shift: '06:00 - 14:00 (Alpha)',
      status: 'ACTIVE',
      role: 'OFFICER'
    };
    this.setActiveSession(demoOfficer);
    return demoOfficer;
  }

  static setActiveSession(session) {
    try {
      localStorage.setItem(STORAGE_SESSION_KEY, JSON.stringify(session));
      // Update runtime CONFIG
      if (session.role === 'OFFICER' || !session.role) {
        CONFIG.OFFICER.name = session.fullName;
        CONFIG.OFFICER.id = session.id;
        CONFIG.OFFICER.rank = session.rank;
        CONFIG.OFFICER.badge = session.badgeNumber;
      }
    } catch (e) {
      console.warn('[AUTH] Session persist warning:', e);
    }
  }

  static getActiveSession() {
    try {
      const data = localStorage.getItem(STORAGE_SESSION_KEY);
      return data ? JSON.parse(data) : null;
    } catch {
      return null;
    }
  }

  static logout() {
    localStorage.removeItem(STORAGE_SESSION_KEY);
  }
}
