/**
 * DocuShield Main Controller & Application Orchestrator
 * Interconnects all 8 Stitch screens, CV Quality Gate, Forensic Pipeline,
 * Cryptographic Ledger, and Store-and-Forward Sync.
 */

import { CONFIG } from './config.js';
import { SAMPLE_SPECIMENS } from './samples.js';
import { QualityGate } from './cv/qualityGate.js';
import { ForensicEngine } from './pipeline/forensicEngine.js';
import { OCREngine } from './pipeline/ocrEngine.js';
import { ledgerInstance } from './ledger/hashChain.js';
import { LedgerRouter } from './ledger/ledgerRouter.js';
import { syncInstance } from './ledger/syncManager.js';
import { BackendAPI } from './api/backendClient.js';
import { AuthManager } from './auth/authManager.js';
import { dbInstance } from './storage/db.js';

class DocuShieldApp {
  constructor() {
    this.currentScreen = 'login';
    this.activeSpecimen = SAMPLE_SPECIMENS[0];
    this.activeFastLaneDoc = null;
    this.activeFastLaneRouting = null;
    this.videoStream = null;
    this.cameraActive = false;
    this.analysisInterval = null;
    this.currentPipelineResult = null;
    this.currentScanId = null;         // UUID for current scan in SQLite
    this.lastCapturedCanvas = null;    // Canvas snapshot for JPEG storage
    this.backendAvailable = false;     // Track backend connectivity
    this.reviewQueue = [];
    this.selectedQueueItem = null;
    this.selectedDocType = this.activeSpecimen?.document_type || 'passport';
    this.isLoggingIn = false;

    // Load persisted review queue
    this.loadQueue();
  }

  loadQueue() {
    try {
      const saved = localStorage.getItem('docushield_review_queue_v1');
      if (saved) {
        this.reviewQueue = JSON.parse(saved);
      } else {
        // Pre-populate with realistic border queue items
        this.reviewQueue = [
          {
            id: 'REV-9941',
            travelerName: 'Sita Devi Rai',
            nationality: 'NPL',
            docNumber: 'NP-482019',
            docType: 'BORDER PERMIT',
            riskScore: 72,
            timestamp: new Date(Date.now() - 3600000).toISOString(),
            anomalies: ['Photo boundary transition anomaly', 'MRZ composite checksum mismatch'],
            status: 'PENDING',
            syncStatus: 'SYNCED',
            photoUrl: 'https://images.unsplash.com/photo-1544005313-94ddf0286df2?w=150&auto=format&fit=crop&q=80'
          },
          {
            id: 'REV-9942',
            travelerName: 'Karan Bahadur',
            nationality: 'NPL',
            docNumber: 'NP-104928',
            docType: 'NATIONAL ID',
            riskScore: 68,
            timestamp: new Date(Date.now() - 7200000).toISOString(),
            anomalies: ['Date of birth font kerning irregular', 'Possible Canva re-print'],
            status: 'PENDING',
            syncStatus: 'LOCAL PENDING',
            photoUrl: 'https://images.unsplash.com/photo-1506794778202-cad84cf45f1d?w=150&auto=format&fit=crop&q=80'
          }
        ];
        this.saveQueue();
      }
    } catch (e) {
      console.warn('Queue load error:', e);
    }
  }

  saveQueue() {
    try {
      localStorage.setItem('docushield_review_queue_v1', JSON.stringify(this.reviewQueue));
    } catch (e) {
      console.error('Queue save error:', e);
    }
  }

  async init() {
    // Bind all interactive events immediately so login and buttons respond instantly
    this.bindEvents();
    this.updateSyncUI();
    syncInstance.subscribe(() => this.updateSyncUI());

    try {
      await AuthManager.initDatabase();
    } catch (e) {
      console.warn('[DocuShield] Database initialization warning:', e);
    }

    // Step 0a: Initialize Dexie.js IndexedDB local database
    try {
      await dbInstance.init();
      window.dbInstance = dbInstance;
      window.db = dbInstance.db;
    } catch (e) {
      console.warn('[DocuShield DB] IndexedDB initialization note:', e);
    }

    // Step 3: Initialize Pretrained Tesseract.js OCR Engine (non-blocking for UI responsiveness)
    try {
      OCREngine.init().then(() => {
        window.OCREngine = OCREngine;
        window.runSampleOCRTest = () => this.handleRunOCRTest();
      }).catch(err => {
        console.warn('[DocuShield OCR] Background OCR init note:', err);
      });
    } catch (e) {
      console.warn('[DocuShield OCR] OCREngine initialization note:', e);
    }

    const activeSession = AuthManager.getActiveSession();
    if (activeSession && activeSession.role === 'OFFICER') {
      this.applyOfficerSession(activeSession, activeSession.isDemo === true);
    }

    this.navigateTo('login');

    // Step 0c: Request camera permission via getUserMedia on first use and request persistent storage
    this.requestFirstUsePermissions();

    // Check backend availability on startup
    BackendAPI.isAvailable().then(available => {
      this.backendAvailable = available;
      console.log(`[DocuShield] Backend SQLite: ${available ? '✅ CONNECTED' : '⚠️ OFFLINE (local-only mode)'}`);
    }).catch(() => {
      this.backendAvailable = false;
    });
  }

  /**
   * Step 0c — Request camera permission via getUserMedia on first use.
   * Request persistent storage permission so IndexedDB data isn't cleared by browser.
   */
  async requestFirstUsePermissions(interactive = false) {
    let cameraGranted = false;
    let storagePersisted = false;

    // 1. Storage Persistence via navigator.storage.persist()
    try {
      const storageRes = await dbInstance.verifyAndRequestPersistence();
      storagePersisted = storageRes.persisted;
    } catch (err) {
      console.warn('[DocuShield Permissions] Storage persistence request warning:', err);
    }

    // 2. Camera Access via navigator.mediaDevices.getUserMedia()
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        let shouldPrompt = false;

        if (navigator.permissions && navigator.permissions.query) {
          try {
            const status = await navigator.permissions.query({ name: 'camera' });
            if (status.state === 'granted') {
              cameraGranted = true;
              localStorage.setItem('docushield_camera_authorized', 'granted');
            } else if (status.state === 'prompt' || interactive) {
              shouldPrompt = true;
            }
          } catch (e) {
            shouldPrompt = true;
          }
        } else {
          shouldPrompt = true;
        }

        const previouslyAuthorized = localStorage.getItem('docushield_camera_authorized');
        if (shouldPrompt || !previouslyAuthorized || interactive) {
          console.log('[DocuShield Permissions] Requesting camera access via getUserMedia on first use...');
          const stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'environment' },
            audio: false
          });
          cameraGranted = true;
          localStorage.setItem('docushield_camera_authorized', 'granted');
          // Release test stream tracks immediately so camera LED turns off
          stream.getTracks().forEach(track => track.stop());
          console.log('[DocuShield Permissions] Camera access confirmed and persisted');
        }
      }
    } catch (camErr) {
      console.warn('[DocuShield Permissions] Camera permission deferred or denied:', camErr);
      cameraGranted = false;
    }

    this.updateHardwareDiagnostics(cameraGranted, storagePersisted);
    return { cameraGranted, storagePersisted };
  }

  updateHardwareDiagnostics(cameraGranted = null, storagePersisted = null) {
    const camBadge = document.getElementById('diag-camera-status');
    const storageBadge = document.getElementById('diag-storage-status');
    const quotaDisplay = document.getElementById('diag-storage-quota');
    const swBadge = document.getElementById('diag-sw-status');

    // Storage Persistence
    if (storageBadge) {
      const isPersisted = storagePersisted !== null ? storagePersisted : dbInstance.persisted;
      if (isPersisted) {
        storageBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-secondary"></span><span>PERSISTENT (DEXIE INDEXEDDB)</span>';
        storageBadge.className = 'text-secondary font-bold flex items-center gap-1';
      } else {
        storageBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-tertiary"></span><span>STANDARD (REQUESTING)</span>';
        storageBadge.className = 'text-tertiary font-bold flex items-center gap-1';
      }
    }

    // Storage Quota
    if (quotaDisplay && dbInstance.storageEstimate) {
      const { quota, usage, percentUsed } = dbInstance.storageEstimate;
      if (quota > 0) {
        quotaDisplay.textContent = `${usage} MB used / ${quota} MB total (${percentUsed}%)`;
      } else {
        quotaDisplay.textContent = 'Unconstrained (IndexedDB)';
      }
    }

    // Camera Permission
    if (camBadge) {
      const isAuth = cameraGranted !== null ? cameraGranted : (localStorage.getItem('docushield_camera_authorized') === 'granted');
      if (isAuth) {
        camBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-secondary"></span><span>AUTHORIZED (PERSISTED)</span>';
        camBadge.className = 'text-secondary font-bold flex items-center gap-1';
      } else {
        camBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-tertiary"></span><span>ACTION REQUIRED (PROMPT)</span>';
        camBadge.className = 'text-tertiary font-bold flex items-center gap-1';
      }
    }

    // Workbox SW Status
    if (swBadge) {
      if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
        swBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-secondary"></span><span>WORKBOX OFFLINE ACTIVE</span>';
        swBadge.className = 'text-secondary font-bold flex items-center gap-1';
      } else {
        swBadge.innerHTML = '<span class="w-2 h-2 rounded-full bg-secondary"></span><span>WORKBOX OFFLINE READY</span>';
      }
    }
  }

  switchLoginTab(tab) {
    const tabOfficer = document.getElementById('tab-btn-officer');
    const tabAdmin = document.getElementById('tab-btn-admin');
    const contentOfficer = document.getElementById('tab-content-officer');
    const contentAdmin = document.getElementById('tab-content-admin');

    if (tab === 'admin') {
      if (tabAdmin) tabAdmin.className = 'py-2.5 rounded-lg bg-surface-container text-tertiary font-bold uppercase transition-all flex items-center justify-center gap-1.5 shadow-sm';
      if (tabOfficer) tabOfficer.className = 'py-2.5 rounded-lg text-on-surface-variant hover:text-on-surface font-semibold uppercase transition-all flex items-center justify-center gap-1.5';
      contentAdmin?.classList.remove('hidden');
      contentOfficer?.classList.add('hidden');
    } else {
      if (tabOfficer) tabOfficer.className = 'py-2.5 rounded-lg bg-surface-container text-primary font-bold uppercase transition-all flex items-center justify-center gap-1.5 shadow-sm';
      if (tabAdmin) tabAdmin.className = 'py-2.5 rounded-lg text-on-surface-variant hover:text-on-surface font-semibold uppercase transition-all flex items-center justify-center gap-1.5';
      contentOfficer?.classList.remove('hidden');
      contentAdmin?.classList.add('hidden');
    }
  }

  async launchDemoMode() {
    try {
      const demoOfficer = await AuthManager.loginDemoMode();
      this.applyOfficerSession(demoOfficer, true);
      this.showToast('⚡ Demo Officer Dashboard Active (Sandbox Mode)');
      this.navigateTo('dashboard');
    } catch (err) {
      console.error('Demo mode launch error:', err);
      this.showToast('Failed to start demo mode. Please try again.');
    }
  }

  async submitOfficerLogin(e) {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    if (this.isLoggingIn) return false;
    this.isLoggingIn = true;

    const officerError = document.getElementById('officer-login-error');
    const officerErrorText = document.getElementById('officer-login-error-text');
    const officerLoginBtn = document.getElementById('btn-officer-login');
    officerError?.classList.add('hidden');

    const officerIdInput = document.getElementById('login-officer-id');
    const passwordInput = document.getElementById('login-officer-password');
    const officerId = (officerIdInput?.value || '').trim();
    const password = passwordInput?.value || '';

    if (!officerId) {
      if (officerErrorText) officerErrorText.textContent = 'Please enter Officer Serial ID.';
      officerError?.classList.remove('hidden');
      this.isLoggingIn = false;
      return false;
    }

    if (officerLoginBtn) {
      officerLoginBtn.disabled = true;
      officerLoginBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span><span>Authenticating Terminal...</span>';
    }

    try {
      const res = await AuthManager.loginOfficer(officerId, password);
      if (res && res.success) {
        if (res.isAdmin) {
          this.showToast('🛡️ Sector Admin Authority Verified');
          this.navigateTo('admin');
        } else {
          this.applyOfficerSession(res.officer, false);
          this.showToast(`✅ Terminal Unlocked: ${res.officer.fullName} (${res.officer.id})`);
          this.navigateTo('dashboard');
        }
      } else {
        if (officerErrorText) officerErrorText.textContent = (res && res.error) || 'Authentication rejected.';
        officerError?.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Officer login error:', err);
      if (officerErrorText) officerErrorText.textContent = 'Authentication service error. Check connection.';
      officerError?.classList.remove('hidden');
    } finally {
      this.isLoggingIn = false;
      if (officerLoginBtn) {
        officerLoginBtn.disabled = false;
        officerLoginBtn.innerHTML = '<span>Sign In to Inspection Console</span><span class="material-symbols-outlined text-[18px]">login</span>';
      }
    }
    return false;
  }

  async submitAdminLogin(e) {
    if (e) {
      if (typeof e.preventDefault === 'function') e.preventDefault();
      if (typeof e.stopPropagation === 'function') e.stopPropagation();
    }
    if (this.isLoggingIn) return false;
    this.isLoggingIn = true;

    const adminError = document.getElementById('admin-login-error');
    const adminErrorText = document.getElementById('admin-login-error-text');
    const adminLoginBtn = document.getElementById('btn-admin-login');
    adminError?.classList.add('hidden');

    const adminId = (document.getElementById('login-admin-id')?.value || 'ADMIN-01').trim();
    const password = document.getElementById('login-admin-password')?.value || '';

    if (adminLoginBtn) {
      adminLoginBtn.disabled = true;
      adminLoginBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span><span>Verifying Authority...</span>';
    }

    try {
      const res = await AuthManager.loginAdmin(adminId, password);
      if (res && res.success) {
        this.showToast('🛡️ Sector Admin Authority Verified');
        this.navigateTo('admin');
      } else {
        if (adminErrorText) adminErrorText.textContent = (res && res.error) || 'Admin authentication failed.';
        adminError?.classList.remove('hidden');
      }
    } catch (err) {
      console.error('Admin login error:', err);
      if (adminErrorText) adminErrorText.textContent = 'Admin service connection error.';
      adminError?.classList.remove('hidden');
    } finally {
      this.isLoggingIn = false;
      if (adminLoginBtn) {
        adminLoginBtn.disabled = false;
        adminLoginBtn.innerHTML = '<span>Sign In to Admin Console</span><span class="material-symbols-outlined text-[18px]">admin_panel_settings</span>';
      }
    }
    return false;
  }

  logoutOfficer() {
    AuthManager.logout();
    this.showToast('Officer session logged out.');
    this.navigateTo('login');
  }

  openAdminConsole() {
    const session = AuthManager.getActiveSession();
    if (session && session.role === 'ADMIN') {
      this.navigateTo('admin');
      this.renderAdminRoster();
    } else {
      this.showToast('⚠️ Sector Admin Authority Required');
      this.navigateTo('login');
      this.switchLoginTab('admin');
    }
  }

  applyOfficerSession(officer, isDemo = false) {
    if (!officer) return;
    const isDemoMode = isDemo === true || officer.isDemo === true;
    const officerId = (officer.id || officer.officer_id || 'SSB-OFFICER').toString().trim().toUpperCase();
    const fullName = officer.fullName || officer.full_name || 'Border Officer';
    const rank = officer.rank || 'Inspector / Screening Lead';
    const badge = officer.badgeNumber || officer.badge_number || 'SSB-REG';
    const checkpoint = officer.checkpointName || officer.checkpoint_name || 'Checkpoint CP-04 (Panitanki Terminal)';
    const shift = officer.shift || '06:00 - 14:00 (Alpha)';

    CONFIG.OFFICER.name = fullName;
    CONFIG.OFFICER.id = officerId;
    CONFIG.OFFICER.rank = rank;
    CONFIG.OFFICER.badge = badge;

    // Derive initials (e.g. "Rameshwar Singh" -> "RS")
    const initials = fullName.split(' ').map(n => n.replace(/[^A-Za-z]/g, '')).filter(Boolean).map(n => n[0]).slice(0, 2).join('').toUpperCase() || 'SO';

    // Header badge
    const headerBadge = document.getElementById('header-officer-badge');
    if (headerBadge) {
      headerBadge.textContent = initials;
      headerBadge.title = isDemoMode ? 'Demo Inspector (Sandbox)' : `${fullName} (${officerId})`;
    }

    // Dashboard card elements
    const dashName = document.getElementById('dash-officer-name');
    const dashMeta = document.getElementById('dash-officer-meta');
    const dashStation = document.getElementById('dash-officer-checkpoint');
    const dashModeIndicator = document.getElementById('dash-mode-indicator');
    const dashSessionBanner = document.getElementById('dash-session-banner');

    if (isDemoMode) {
      if (dashModeIndicator) {
        dashModeIndicator.innerHTML = `
          <span class="material-symbols-outlined text-primary text-[18px]">play_circle</span>
          <span class="text-xs uppercase text-primary font-bold">Officer Demo Workstation (Sandbox)</span>
        `;
      }
      if (dashStation) {
        dashStation.innerHTML = `<span class="material-symbols-outlined text-[15px] text-primary">location_on</span><span class="text-primary font-bold text-xs uppercase">Checkpoint CP-04 (Panitanki Border Post)</span>`;
      }
      if (dashName) {
        dashName.innerHTML = `${fullName} <span class="text-primary text-xs px-2 py-0.5 rounded-full bg-primary/15 font-semibold">Demo Officer</span>`;
      }
      if (dashMeta) {
        dashMeta.innerHTML = `<span>Shift: ${shift}</span><span>•</span><span>Demo ID: ${officerId}</span><span>•</span><span class="text-secondary font-semibold">Sandbox Active</span>`;
      }
      if (dashSessionBanner) {
        dashSessionBanner.className = 'w-full px-4 py-2.5 rounded-2xl bg-surface-container border border-primary/30 flex items-center justify-between text-xs text-on-surface mb-2 shadow-sm';
        dashSessionBanner.innerHTML = `
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-[20px] text-primary">info</span>
            <div>
              <span class="font-bold text-on-surface">Interactive Officer Sandbox</span>
              <span class="text-xs text-on-surface-variant block sm:inline sm:ml-2">All document verification and forensic checks active.</span>
            </div>
          </div>
          <button type="button" onclick="window.app?.logoutOfficer?.()" class="px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-surface-container-highest text-xs text-on-surface font-semibold transition-all flex-shrink-0 border border-outline/20">
            Exit Demo
          </button>
        `;
        dashSessionBanner.classList.remove('hidden');
      }
    } else {
      // AUTHENTICATED BORDER OFFICER DASHBOARD SPECIFIC TO THIS SERIAL ID
      if (dashModeIndicator) {
        dashModeIndicator.innerHTML = `
          <span class="material-symbols-outlined text-secondary text-[18px]">verified_user</span>
          <span class="text-xs uppercase text-secondary font-bold">Active Duty Station · Officer ${officerId}</span>
        `;
      }
      if (dashStation) {
        dashStation.innerHTML = `<span class="material-symbols-outlined text-[15px] text-primary">location_on</span><span class="text-primary font-bold text-xs uppercase">${checkpoint.toUpperCase()}</span>`;
      }
      if (dashName) {
        dashName.innerHTML = `${fullName} <span class="text-secondary text-xs px-2.5 py-0.5 rounded-full bg-secondary/15 font-bold">${badge}</span>`;
      }
      if (dashMeta) {
        dashMeta.innerHTML = `<span>Shift: ${shift}</span><span>•</span><span class="text-secondary font-bold font-mono">ID: ${officerId}</span><span>•</span><span>Rank: ${rank}</span>`;
      }
      if (dashSessionBanner) {
        dashSessionBanner.className = 'w-full px-4 py-2.5 rounded-2xl bg-surface-container border border-secondary/30 flex items-center justify-between text-xs text-on-surface mb-2 shadow-sm';
        dashSessionBanner.innerHTML = `
          <div class="flex items-center gap-2.5">
            <span class="material-symbols-outlined text-[20px] text-secondary">verified</span>
            <div>
              <span class="font-bold text-on-surface">Verified Duty Station · Officer ${officerId}</span>
              <span class="text-xs text-on-surface-variant block sm:inline sm:ml-2">Station verified for ${fullName} (${rank}).</span>
            </div>
          </div>
          <button type="button" onclick="window.app?.logoutOfficer?.()" class="px-3 py-1.5 rounded-xl bg-surface-container-high hover:bg-error/15 text-xs text-on-surface hover:text-error font-semibold transition-all flex-shrink-0 border border-outline/20">
            Sign Out
          </button>
        `;
        dashSessionBanner.classList.remove('hidden');
      }
    }

    // Profile card
    const profileAvatar = document.getElementById('profile-officer-avatar');
    const profileName = document.getElementById('profile-officer-name');
    const profileRankId = document.getElementById('profile-officer-rank-id');
    const profileStation = document.getElementById('profile-officer-station');
    if (profileAvatar) profileAvatar.textContent = initials;
    if (profileName) profileName.textContent = isDemoMode ? `${fullName} (Demo Sandbox)` : fullName;
    if (profileRankId) profileRankId.textContent = `SERIAL ID: ${officerId} · ${rank}`;
    if (profileStation) profileStation.textContent = `${checkpoint} (${shift})`;
  }

  navigateTo(screenId) {
    // Hide all screens
    const screens = document.querySelectorAll('.screen-view');
    screens.forEach(s => s.classList.add('hidden'));

    // Show target screen
    const target = document.getElementById(`screen-${screenId}`);
    if (target) {
      target.classList.remove('hidden');
      this.currentScreen = screenId;
      window.scrollTo({ top: 0, behavior: 'smooth' });
      this.onScreenEnter(screenId);
    }

    // Header & Bottom Navigation visibility
    const header = document.getElementById('app-header');
    const nav = document.getElementById('app-navigation');

    if (screenId === 'login' || screenId === 'admin') {
      if (header) header.classList.add('hidden');
      if (nav) nav.classList.add('hidden');
    } else {
      if (header) header.classList.remove('hidden');
      if (nav) nav.classList.remove('hidden');
      this.updateActiveNav(screenId);
    }
  }

  updateActiveNav(screenId) {
    const navItems = document.querySelectorAll('.nav-btn');
    navItems.forEach(btn => {
      const target = btn.dataset.screen;
      const icon = btn.querySelector('.nav-icon');
      const label = btn.querySelector('.nav-label');
      if (target === screenId || (screenId === 'approved' && target === 'capture') || (screenId === 'flagged' && target === 'capture')) {
        btn.classList.add('text-primary');
        btn.classList.remove('text-on-surface-variant');
        if (icon) icon.classList.add('fill');
      } else {
        btn.classList.remove('text-primary');
        btn.classList.add('text-on-surface-variant');
        if (icon) icon.classList.remove('fill');
      }
    });
  }

  async onScreenEnter(screenId) {
    if (screenId !== 'capture') {
      this.stopCamera();
    }

    switch (screenId) {
      case 'dashboard':
        this.renderDashboardMetrics();
        break;
      case 'capture':
        this.startCamera();
        this.renderSpecimenSelector();
        this.updateViewfinderForDocType(this.selectedDocType);
        break;
      case 'queue':
        this.renderReviewQueue();
        break;
      case 'audit':
        this.renderAuditLog();
        break;
      case 'profile':
        this.renderProfile();
        break;
      case 'admin':
        this.renderAdminRoster();
        this.renderAdminPolicies();
        this.renderAdminAudit();
        break;
    }
  }

  // --- CAMERA & COMPUTER VISION QUALITY GATE ---

  async startCamera() {
    const video = document.getElementById('camera-video');
    const canvas = document.getElementById('camera-canvas');
    if (!video || !canvas) return;

    try {
      this.videoStream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });
      video.srcObject = this.videoStream;
      await video.play();
      this.cameraActive = true;
      video.classList.remove('hidden');
      const previewImg = document.getElementById('specimen-preview-img');
      if (previewImg) previewImg.classList.add('hidden');

      // Start live quality gate telemetry loop
      this.startQualityTelemetry(video, canvas);
    } catch (err) {
      console.warn('Camera access unavailable or declined, running in specimen mode:', err);
      this.cameraActive = false;
      video.classList.add('hidden');
      const previewImg = document.getElementById('specimen-preview-img');
      if (previewImg) previewImg.classList.remove('hidden');
      this.updateQualityHUD(this.activeSpecimen.qualityResult);
    }
  }

  stopCamera() {
    if (this.analysisInterval) {
      clearInterval(this.analysisInterval);
      this.analysisInterval = null;
    }
    if (this.videoStream) {
      this.videoStream.getTracks().forEach(track => track.stop());
      this.videoStream = null;
    }
    this.cameraActive = false;
  }

  startQualityTelemetry(video, canvas) {
    if (this.analysisInterval) clearInterval(this.analysisInterval);
    const ctx = canvas.getContext('2d');

    this.analysisInterval = setInterval(() => {
      if (!this.cameraActive || video.videoWidth === 0) return;
      canvas.width = 360;
      canvas.height = 270;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      const quality = QualityGate.analyzeImageQuality(canvas);
      this.updateQualityHUD(quality);
    }, 400);
  }

  updateQualityHUD(quality) {
    const hudBanner = document.getElementById('hud-status-banner');
    const hudText = document.getElementById('hud-text');
    const hudDetail = document.getElementById('hud-detail');
    const hudLockPct = document.getElementById('hud-lock-pct');
    const hudIcon = document.getElementById('hud-icon');
    const bracketMarks = document.querySelectorAll('.bracket-mark');

    // Telemetry indicators
    const glareVal = document.getElementById('telemetry-glare-val');
    const framingVal = document.getElementById('telemetry-framing-val');
    const blurVal = document.getElementById('telemetry-blur-val');

    if (!quality) return;

    const glareStatus = quality.checks?.glare?.status || (quality.overexposedPct > 5 ? 'FAIL' : 'PASS');
    const framingStatus = quality.checks?.framing?.status || (quality.framingScore > 80 ? 'PASS' : 'ADJUST');
    const blurStatus = quality.checks?.blur?.status || (quality.laplacianVariance >= 100 ? 'PASS' : 'BLURRY');

    if (glareVal) glareVal.textContent = `${glareStatus} (${quality.overexposedPct ?? 0}%)`;
    if (framingVal) framingVal.textContent = `${framingStatus} (${quality.framingScore ?? 95}%)`;
    if (blurVal) blurVal.textContent = `${blurStatus} (VAR: ${quality.laplacianVariance ?? 150})`;

    if (quality.passed) {
      if (hudBanner) hudBanner.className = 'w-full flex items-center justify-between px-space-md py-space-sm rounded-xl bg-surface-container border border-secondary/40 transition-colors duration-300';
      if (hudText) {
        hudText.textContent = 'DOCUMENT POSITIONED · READY TO SCAN';
        hudText.className = 'text-xs font-bold text-secondary uppercase tracking-wide';
      }
      if (hudDetail) hudDetail.textContent = 'Hold passport steady inside the alignment frame';
      if (hudLockPct) hudLockPct.textContent = 'READY';
      if (hudIcon) {
        hudIcon.textContent = 'verified';
        hudIcon.className = 'material-symbols-outlined text-[20px] text-secondary';
      }
      bracketMarks.forEach(bm => {
        bm.style.backgroundColor = '#10b981';
      });
    } else {
      if (hudBanner) hudBanner.className = 'w-full flex items-center justify-between px-space-md py-space-sm rounded-xl bg-surface-container border border-tertiary/40 transition-colors duration-300';
      if (hudText) {
        hudText.textContent = quality.retakePrompt || 'ADJUST DOCUMENT POSITION';
        hudText.className = 'text-xs font-bold text-tertiary uppercase tracking-wide';
      }
      if (hudDetail) hudDetail.textContent = quality.guidanceAdvice || 'Center passport inside boundary guides';
      if (hudLockPct) hudLockPct.textContent = 'ADJUST';
      if (hudIcon) {
        hudIcon.textContent = 'warning';
        hudIcon.className = 'material-symbols-outlined text-[20px] text-tertiary animate-pulse';
      }
      bracketMarks.forEach(bm => {
        bm.style.backgroundColor = '#f59e0b';
      });
    }
  }

  showRetakeModal(quality) {
    const modal = document.getElementById('retake-modal');
    const reasonEl = document.getElementById('retake-modal-reason');
    const adviceEl = document.getElementById('retake-modal-advice');
    if (!modal) return;

    if (reasonEl) reasonEl.textContent = quality.retakePrompt || 'CAPTURE QUALITY CHECK FAILED';
    if (adviceEl) adviceEl.textContent = quality.guidanceAdvice || 'Adjust camera position and lighting, then try again.';
    modal.classList.remove('hidden');
  }

  hideRetakeModal() {
    const modal = document.getElementById('retake-modal');
    if (modal) modal.classList.add('hidden');
  }

  // --- SPECIMEN SELECTOR ---

  renderSpecimenSelector() {
    const container = document.getElementById('specimen-selector-container');
    if (!container) return;

    container.innerHTML = SAMPLE_SPECIMENS.map(spec => `
      <button type="button" data-id="${spec.id}" class="specimen-chip text-left p-3 rounded-2xl border transition-all ${
        this.activeSpecimen.id === spec.id
          ? 'bg-surface-container-high border-2 border-primary text-on-surface shadow-md'
          : 'bg-surface-container border border-outline/20 text-on-surface-variant hover:border-outline/40 hover:bg-surface-container-high'
      }">
        <div class="flex items-center justify-between mb-1 gap-1">
          <span class="text-xs font-bold text-on-surface truncate">${spec.title.split(':')[1] || spec.title}</span>
          <span class="text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            spec.badgeColor === 'secondary' ? 'bg-secondary/15 text-secondary' : 'bg-tertiary/15 text-tertiary'
          }">${spec.badge}</span>
        </div>
        <p class="text-[11px] text-on-surface-variant truncate">${spec.subtitle}</p>
      </button>
    `).join('');

    container.querySelectorAll('.specimen-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const found = SAMPLE_SPECIMENS.find(s => s.id === btn.dataset.id);
        if (found) {
          this.activeSpecimen = found;
          this.selectedDocType = found.document_type || 'passport';
          const docTypeSelect = document.getElementById('capture-doc-type-select');
          if (docTypeSelect) {
            docTypeSelect.value = this.selectedDocType;
          }
          this.renderSpecimenSelector();
          this.stopCamera();
          const previewImg = document.getElementById('specimen-preview-img');
          const video = document.getElementById('camera-video');
          if (video) video.classList.add('hidden');
          if (previewImg) {
            previewImg.classList.remove('hidden');
            previewImg.style.backgroundImage = `url("${found.photoUrl}")`;
          }
          this.updateQualityHUD(found.qualityResult);
          this.updateViewfinderForDocType(this.selectedDocType);
        }
      });
    });
  }

  // --- VIEWFINDER GUIDANCE TAILORED TO DOCUMENT TYPE ---

  updateViewfinderForDocType(docType) {
    const docLabel = document.getElementById('viewfinder-doc-label');
    const specLabel = document.getElementById('viewfinder-spec-label');
    const zoneTitle = document.getElementById('viewfinder-zone-title');
    const zoneSubtitle = document.getElementById('viewfinder-zone-subtitle');
    const zoneSample = document.getElementById('viewfinder-zone-sample');
    const hudDetail = document.getElementById('hud-detail');

    if (docType === 'visa') {
      if (docLabel) docLabel.textContent = 'Visa / Transit Permit Alignment Box';
      if (specLabel) specLabel.textContent = 'NON-MRZ ENTRY VISA';
      if (zoneTitle) zoneTitle.textContent = 'Visa Field Regions';
      if (zoneSubtitle) zoneSubtitle.textContent = 'Rule-Based Checks (MRZ Skipped)';
      if (zoneSample) zoneSample.textContent = 'VISA TYPE · SPONSOR · ENTRIES · EXPIRY';
      if (hudDetail) hudDetail.textContent = 'Hold entry visa steady inside frame (Field format & date logic checks)';
    } else if (docType === 'national_id') {
      if (docLabel) docLabel.textContent = 'National Identity Card Alignment Box';
      if (specLabel) specLabel.textContent = 'NATIONAL ID';
      if (zoneTitle) zoneTitle.textContent = 'ID Demographic & Boundary Zone';
      if (zoneSubtitle) zoneSubtitle.textContent = 'Format & Address Cross-Check';
      if (zoneSample) zoneSample.textContent = 'CITIZEN ID · ADDRESS · GUARDIAN INFO';
      if (hudDetail) hudDetail.textContent = 'Hold national ID steady inside the alignment frame';
    } else {
      if (docLabel) docLabel.textContent = 'Passport / ID Alignment Box';
      if (specLabel) specLabel.textContent = 'ICAO 9303';
      if (zoneTitle) zoneTitle.textContent = 'Machine-Readable Zone (MRZ)';
      if (zoneSubtitle) zoneSubtitle.textContent = 'Checksum Target';
      if (zoneSample) zoneSample.textContent = 'P<INDSHARMA<<RAHUL<<<<<<<<<<<<<<<<<<<<<<<<<<';
      if (hudDetail) hudDetail.textContent = 'Hold passport steady inside the alignment frame';
    }
  }

  // --- DOCUMENT IMAGE UPLOAD (FOR LAPTOP / DESKTOP TESTING) ---

  /**
   * Handles user-uploaded document image file (JPG, PNG)
   * Analyzes quality using OpenCV.js (blur + glare detection),
   * prompts retake if blurry, or saves blob and prepares for screening.
   * @param {File} file
   */
  async handleImageUpload(file) {
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (e) => {
      const img = new Image();
      img.onload = async () => {
        const canvas = document.getElementById('camera-canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0);

        // Update preview image in UI
        const previewImg = document.getElementById('specimen-preview-img');
        if (previewImg) {
          previewImg.style.backgroundImage = `url("${e.target.result}")`;
          previewImg.classList.remove('hidden');
        }
        const video = document.getElementById('camera-video');
        if (video) video.classList.add('hidden');
        this.stopCamera();

        // Run QualityGate blur & glare detection (OpenCV.js + fallback)
        const quality = QualityGate.analyzeImageQuality(canvas);
        console.log(`[QualityGate] Image quality analysis (${quality.engine}):`, quality);
        this.updateQualityHUD(quality);

        if (!quality.passed) {
          this.showRetakeModal(quality);
          return;
        }

        // Passed quality gate -> save JPEG blob into IndexedDB immediately (Step 2)
        const recordId = crypto.randomUUID ? crypto.randomUUID() :
          'scan-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        this.currentScanId = recordId;
        this.lastCapturedCanvas = canvas;

        try {
          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
          if (blob) {
            const activeOfficer = AuthManager.getActiveSession();
            await dbInstance.saveScanRecord({
              record_id: recordId,
              image_blob: blob,
              checkpoint_id: CONFIG.OFFICER?.checkpoint || 'CP-04-NORTH',
              officer_id: activeOfficer?.id || CONFIG.OFFICER?.id || 'SSB-OFFICER',
              timestamp: new Date().toISOString(),
              image_path: `indexeddb://image_blobs/${recordId}`,
              document_type: this.selectedDocType || this.activeSpecimen?.document_type || 'passport',
              status: 'captured'
            });
            await dbInstance.saveImageBlob(recordId, blob, quality);
            console.log(`[Step 2] ✅ Record stored in IndexedDB (Dexie.js): ${recordId} [image_blob: ${(blob.size / 1024).toFixed(1)} KB, status: 'captured']`);
          }
        } catch (saveErr) {
          console.warn('[Step 2] Uploaded blob save error:', saveErr);
        }

        this.showToast(`✅ Quality Gate Passed (Variance: ${quality.laplacianVariance} via ${quality.engine}) · Click Capture & Verify`);
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  }

  // --- STEP 3: PRETRAINED TESSERACT.JS OCR TEST & EXTRACTION ---

  /**
   * Run OCR test on a sample document image (or active captured canvas)
   * Displays raw text before field extraction to confirm OCR engine readiness.
   */
  async handleRunOCRTest(customImage = null) {
    this.showToast('🔍 Initializing Tesseract.js OCR engine...');

    let imageSource = customImage;
    if (!imageSource) {
      if (this.lastCapturedCanvas) {
        imageSource = this.lastCapturedCanvas;
      } else {
        // Generate high-contrast sample passport canvas with visual fields and MRZ
        imageSource = OCREngine.generateSampleDocumentCanvas(this.activeSpecimen);
      }
    }

    try {
      const result = await OCREngine.recognize(imageSource);
      console.log('[Step 3 OCR Test] Extracted raw text result:', result);

      const modal = document.getElementById('ocr-result-modal');
      const rawTextEl = document.getElementById('ocr-modal-rawtext');
      const statusEl = document.getElementById('ocr-modal-status');
      const engineEl = document.getElementById('ocr-modal-engine');
      const charsEl = document.getElementById('ocr-modal-chars');
      const confEl = document.getElementById('ocr-modal-confidence');

      if (rawTextEl) rawTextEl.textContent = result.rawText || '(No text detected)';
      if (statusEl) statusEl.textContent = result.success ? 'Raw Text Successfully Extracted' : 'Extraction Inconclusive';
      if (engineEl) engineEl.textContent = result.engine || 'Tesseract.js';
      if (charsEl) charsEl.textContent = `Characters: ${(result.rawText || '').length} · Lines: ${(result.lines || []).length}`;
      if (confEl) confEl.textContent = `Confidence: ${(result.confidence || 90).toFixed(1)}%`;

      if (modal) modal.classList.remove('hidden');

      this.showToast(`✅ Step 3: OCR raw text confirmed (${(result.rawText || '').length} chars)`);
      return result;
    } catch (err) {
      console.error('[Step 3 OCR Test] Error during test:', err);
      this.showToast('⚠️ OCR Test warning: ' + err.message);
    }
  }

  hideOCRModal() {
    const modal = document.getElementById('ocr-result-modal');
    if (modal) modal.classList.add('hidden');
  }

  // --- STEP 4: STRUCTURED OCR FIELD EXTRACTION & INSPECTION PANEL CONTROLLER ---

  /**
   * Handle interactive button click to inspect extracted fields directly
   * side-by-side with document image preview.
   */
  async handleInspectExtractedFields() {
    const officerDocType = document.getElementById('capture-doc-type-select')?.value || this.selectedDocType || this.activeSpecimen?.document_type || 'passport';
    this.selectedDocType = officerDocType;

    let imgSrc = null;
    if (this.lastCapturedCanvas && this.lastCapturedCanvas.toDataURL) {
      imgSrc = this.lastCapturedCanvas.toDataURL('image/jpeg', 0.85);
    } else {
      imgSrc = this.activeSpecimen?.photoUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600';
    }

    // Extract fields via template parser
    const rawText = OCREngine.lastRawText || '';
    const extracted = OCREngine.extractFieldsByTemplate(rawText, officerDocType, {
      ...this.activeSpecimen?.visualFields,
      mrzLines: this.activeSpecimen?.mrzLines,
      extra_fields: this.activeSpecimen?.extra_fields
    });

    const recordId = this.currentScanId || ('scan-' + Date.now().toString(36));
    const record = {
      record_id: recordId,
      document_type: officerDocType,
      name: extracted.name,
      date_of_birth: extracted.date_of_birth,
      document_number: extracted.document_number,
      nationality: extracted.nationality,
      gender: extracted.gender,
      issue_date: extracted.issue_date,
      expiry_date: extracted.expiry_date,
      mrz_raw: extracted.mrz_raw,
      extra_fields: extracted.extra_fields
    };

    this.currentExtractedRecord = record;
    this.populateInspectionModal(record, imgSrc);
    this.openExtractedFieldsModal();
    this.showToast(`🔍 Inspecting ${officerDocType.toUpperCase()} Extracted Fields Side-by-Side`);
  }

  /**
   * Populate and render Extracted Fields Inspection Panel on Approved or Flagged screen
   * @param {Object} extracted - Structured 11-column fields
   * @param {HTMLCanvasElement|string} imageSource - Document image canvas or URL
   * @param {string} decision - 'APPROVED' | 'FLAGGED'
   */
  renderExtractedFieldsInspection(extracted, imageSource, decision = 'APPROVED') {
    if (!extracted) return;
    this.currentExtractedRecord = extracted;

    const docType = (extracted.document_type || 'passport').toLowerCase();

    // Determine image URL or data
    let imgSrc = null;
    if (typeof imageSource === 'string') {
      imgSrc = imageSource;
    } else if (imageSource && imageSource.toDataURL) {
      imgSrc = imageSource.toDataURL('image/jpeg', 0.85);
    } else {
      imgSrc = this.activeSpecimen?.photoUrl || 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=600';
    }

    const formatExtraFieldsHTML = (extra) => {
      if (!extra || Object.keys(extra).length === 0) {
        return '<span class="text-xs text-on-surface-variant italic">No extra fields defined for this document.</span>';
      }
      return Object.entries(extra).map(([k, v]) => {
        const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return `
          <div class="p-2.5 rounded-xl bg-surface-container-high border border-outline/20 flex flex-col justify-between shadow-xs">
            <span class="text-[9px] uppercase font-bold text-on-surface-variant tracking-wider block">${label}</span>
            <span class="text-xs font-semibold text-on-surface block mt-1 font-mono truncate text-primary-fixed" title="${v || '—'}">${v || '—'}</span>
          </div>
        `;
      }).join('');
    };

    const formatMrzBox = (preEl, badgeEl, mrzRaw) => {
      if (mrzRaw && mrzRaw.trim().length > 0) {
        if (preEl) {
          preEl.textContent = mrzRaw;
          preEl.className = 'font-mono text-[10px] text-on-surface tracking-wider bg-surface-container-lowest p-2.5 rounded-xl overflow-x-auto whitespace-pre select-all leading-tight border border-outline/20';
        }
        if (badgeEl) {
          badgeEl.textContent = 'CHECKSUM VALID';
          badgeEl.className = 'text-[10px] font-mono text-secondary font-bold px-2 py-0.5 rounded bg-secondary/15 border border-secondary/30';
        }
      } else {
        if (preEl) {
          preEl.textContent = `[NON-MRZ DOCUMENT FORMAT: ${docType.toUpperCase()}]\nStandard field format and chronology rules applied. MRZ zone check skipped cleanly (0 penalty).`;
          preEl.className = 'font-mono text-[10px] text-primary-fixed tracking-wide bg-surface-container-lowest/80 p-2.5 rounded-xl whitespace-pre-wrap leading-relaxed border border-primary/20';
        }
        if (badgeEl) {
          badgeEl.textContent = 'NON-MRZ FORMAT (BYPASSED)';
          badgeEl.className = 'text-[10px] font-mono text-primary font-bold px-2 py-0.5 rounded bg-primary/15 border border-primary/30';
        }
      }
    };

    const prefix = decision === 'APPROVED' ? 'approved' : 'flagged';
    const docImgEl = document.getElementById(`${prefix}-inspect-doc-img`);
    const docTypeEl = document.getElementById(`${prefix}-panel-doc-type`);
    const nameEl = document.getElementById(`${prefix}-field-name`);
    const docNumEl = document.getElementById(`${prefix}-field-docnum`);
    const natEl = document.getElementById(`${prefix}-field-nat`);
    const genderEl = document.getElementById(`${prefix}-field-gender`);
    const dobEl = document.getElementById(`${prefix}-field-dob`);
    const issueEl = document.getElementById(`${prefix}-field-issue`);
    const expEl = document.getElementById(`${prefix}-field-exp`);
    const extraContainer = document.getElementById(`${prefix}-extra-fields-container`);
    const extraCountEl = document.getElementById(`${prefix}-extra-count`);
    const mrzPre = document.getElementById(`${prefix}-field-mrz`);
    const mrzBadge = document.getElementById(`${prefix}-mrz-badge`);

    if (docImgEl && imgSrc) docImgEl.src = imgSrc;
    if (docTypeEl) docTypeEl.textContent = docType.toUpperCase();
    if (nameEl) nameEl.textContent = extracted.name || 'UNKNOWN';
    if (docNumEl) docNumEl.textContent = extracted.document_number || '—';
    if (natEl) natEl.textContent = extracted.nationality || '—';
    if (genderEl) genderEl.textContent = (extracted.gender === 'M' ? 'MALE' : (extracted.gender === 'F' ? 'FEMALE' : extracted.gender || '—'));
    if (dobEl) dobEl.textContent = extracted.date_of_birth || '—';
    if (issueEl) issueEl.textContent = extracted.issue_date || '—';
    if (expEl) expEl.textContent = extracted.expiry_date || '—';

    const extraFields = typeof extracted.extra_fields === 'string' ? JSON.parse(extracted.extra_fields || '{}') : (extracted.extra_fields || {});
    if (extraContainer) extraContainer.innerHTML = formatExtraFieldsHTML(extraFields);
    if (extraCountEl) extraCountEl.textContent = `${Object.keys(extraFields).length} fields`;

    formatMrzBox(mrzPre, mrzBadge, extracted.mrz_raw);

    // Also populate the side-by-side modal for deep inspection
    this.populateInspectionModal(extracted, imgSrc);
  }

  /**
   * Populates the dedicated Side-by-Side Extracted Fields Inspection Modal
   */
  populateInspectionModal(extracted, imgSrc) {
    if (!extracted) return;
    const docType = (extracted.document_type || 'passport').toLowerCase();

    const modalDocType = document.getElementById('modal-field-doc-type');
    const modalScanId = document.getElementById('modal-field-scan-id');
    const modalDocImg = document.getElementById('modal-inspect-doc-img');
    const modalName = document.getElementById('modal-field-name');
    const modalDocNum = document.getElementById('modal-field-docnum');
    const modalNat = document.getElementById('modal-field-nat');
    const modalGender = document.getElementById('modal-field-gender');
    const modalDob = document.getElementById('modal-field-dob');
    const modalIssue = document.getElementById('modal-field-issue');
    const modalExp = document.getElementById('modal-field-exp');
    const modalExtraContainer = document.getElementById('modal-extra-fields-container');
    const modalExtraCount = document.getElementById('modal-extra-count');
    const modalMrzPre = document.getElementById('modal-field-mrz');
    const modalMrzBadge = document.getElementById('modal-mrz-badge');

    if (modalDocType) modalDocType.textContent = docType.toUpperCase();
    if (modalScanId) modalScanId.textContent = extracted.record_id || this.currentScanId || 'scan-active';
    if (modalDocImg && imgSrc) modalDocImg.src = imgSrc;
    if (modalName) modalName.textContent = extracted.name || 'UNKNOWN';
    if (modalDocNum) modalDocNum.textContent = extracted.document_number || '—';
    if (modalNat) modalNat.textContent = extracted.nationality || '—';
    if (modalGender) modalGender.textContent = (extracted.gender === 'M' ? 'MALE' : (extracted.gender === 'F' ? 'FEMALE' : extracted.gender || '—'));
    if (modalDob) modalDob.textContent = extracted.date_of_birth || '—';
    if (modalIssue) modalIssue.textContent = extracted.issue_date || '—';
    if (modalExp) modalExp.textContent = extracted.expiry_date || '—';

    const extraFields = typeof extracted.extra_fields === 'string' ? JSON.parse(extracted.extra_fields || '{}') : (extracted.extra_fields || {});
    if (modalExtraContainer) {
      if (Object.keys(extraFields).length === 0) {
        modalExtraContainer.innerHTML = '<span class="text-xs text-on-surface-variant italic">No document-specific extra fields</span>';
      } else {
        modalExtraContainer.innerHTML = Object.entries(extraFields).map(([k, v]) => {
          const label = k.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
          return `
            <div class="p-2.5 rounded-xl bg-surface-container-high/80 border border-outline/20">
              <span class="text-[9px] uppercase font-bold text-on-surface-variant block">${label}</span>
              <span class="text-xs font-semibold text-on-surface block mt-0.5 font-mono select-all truncate text-primary-fixed">${v || '—'}</span>
            </div>
          `;
        }).join('');
      }
    }
    if (modalExtraCount) modalExtraCount.textContent = `${Object.keys(extraFields).length} fields`;

    if (modalMrzPre) {
      if (extracted.mrz_raw && extracted.mrz_raw.trim().length > 0) {
        modalMrzPre.textContent = extracted.mrz_raw;
        modalMrzPre.className = 'font-mono text-[10px] text-on-surface tracking-wider bg-surface-container-lowest p-2.5 rounded-lg overflow-x-auto whitespace-pre select-all leading-tight';
        if (modalMrzBadge) {
          modalMrzBadge.textContent = 'CHECKSUM VALID';
          modalMrzBadge.className = 'text-[10px] font-mono text-secondary font-semibold';
        }
      } else {
        modalMrzPre.textContent = `[NON-MRZ FORMAT: ${docType.toUpperCase()}]\nStandard field format and chronology rules applied. MRZ zone check skipped with 0 penalty.`;
        modalMrzPre.className = 'font-mono text-[10px] text-primary-fixed tracking-wide bg-surface-container-lowest/80 p-2.5 rounded-lg whitespace-pre-wrap leading-relaxed border border-primary/20';
        if (modalMrzBadge) {
          modalMrzBadge.textContent = 'NON-MRZ FORMAT (BYPASSED)';
          modalMrzBadge.className = 'text-[10px] font-mono text-primary font-semibold';
        }
      }
    }
  }

  openExtractedFieldsModal() {
    const modal = document.getElementById('extracted-fields-inspection-modal');
    if (modal) modal.classList.remove('hidden');
  }

  closeExtractedFieldsModal() {
    const modal = document.getElementById('extracted-fields-inspection-modal');
    if (modal) modal.classList.add('hidden');
  }

  // --- EXECUTE FORENSIC PIPELINE & PROCESSING ---

  async triggerCapture() {
    let docDataToScreen = { ...this.activeSpecimen };

    // Resolve officer-selected document type from capture screen dropdown
    const officerDocType = document.getElementById('capture-doc-type-select')?.value || this.selectedDocType || docDataToScreen.document_type || 'passport';
    this.selectedDocType = officerDocType;
    docDataToScreen.document_type = officerDocType;
    if (!docDataToScreen.visualFields) docDataToScreen.visualFields = {};
    docDataToScreen.visualFields.documentType = officerDocType;

    // For non-MRZ documents (e.g. Visa), clear MRZ expectations so pipeline skips MRZ check cleanly
    if (officerDocType === 'visa') {
      docDataToScreen.mrzLines = [];
    }

    // Attach type-specific extra_fields template if not present
    if (!docDataToScreen.extra_fields) {
      if (officerDocType === 'passport') {
        docDataToScreen.extra_fields = {
          issuing_authority: 'RPO DELHI',
          place_of_birth: 'NEW DELHI',
          passport_type: 'REGULAR'
        };
      } else if (officerDocType === 'national_id') {
        docDataToScreen.extra_fields = {
          address: 'Kathmandu, Ward 4, Nepal',
          id_card_type: 'CITIZENSHIP_CARD',
          parent_or_guardian_name: 'Bir Bahadur Thapa'
        };
      } else if (officerDocType === 'visa') {
        docDataToScreen.extra_fields = {
          visa_type: 'TOURIST',
          linked_passport_number: 'GBR-8830192',
          sponsor_name: 'MINISTRY OF EXTERNAL AFFAIRS',
          number_of_entries_allowed: 'MULTIPLE',
          issuing_country: 'IND'
        };
      }
    }

    // Step A3a: Capture Quality Gate (Laplacian blur & glare check)
    if (this.cameraActive) {
      const canvas = document.getElementById('camera-canvas');
      const quality = QualityGate.analyzeImageQuality(canvas);
      if (!quality.passed) {
        this.showRetakeModal(quality);
        return;
      }
      docDataToScreen.qualityResult = quality;

      // ── Step 2: Capture quality-gate-approved frame and store in IndexedDB ──
      const recordId = crypto.randomUUID ? crypto.randomUUID() :
        'scan-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
      this.currentScanId = recordId;

      // Create a full-resolution capture canvas
      const video = document.getElementById('camera-video');
      const captureCanvas = document.createElement('canvas');
      captureCanvas.width = video.videoWidth || 1280;
      captureCanvas.height = video.videoHeight || 720;
      captureCanvas.getContext('2d').drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);
      this.lastCapturedCanvas = captureCanvas;

      // Convert to JPEG blob and save locally in IndexedDB (Step 2)
      try {
        const blob = await new Promise((resolve) => {
          captureCanvas.toBlob(resolve, 'image/jpeg', 0.85);
        });
        if (blob) {
          const activeOfficer = AuthManager.getActiveSession();
          await dbInstance.saveScanRecord({
            record_id: recordId,
            image_blob: blob,
            checkpoint_id: CONFIG.OFFICER?.checkpoint || 'CP-04-NORTH',
            officer_id: activeOfficer?.id || CONFIG.OFFICER?.id || 'SSB-OFFICER',
            timestamp: new Date().toISOString(),
            image_path: `indexeddb://image_blobs/${recordId}`,
            document_type: officerDocType,
            status: 'captured'
          });
          await dbInstance.saveImageBlob(recordId, blob, quality);

          console.log(`[Step 2] ✅ Record stored in IndexedDB (Dexie.js): ${recordId} [image_blob: ${(blob.size / 1024).toFixed(1)} KB, status: 'captured']`);
        }
      } catch (blobErr) {
        console.warn('[Step 2] Local blob save warning (non-blocking):', blobErr);
      }
    } else {
      // Offline Specimen or Pre-captured image mode
      if (docDataToScreen.qualityResult && docDataToScreen.qualityResult.passed === false) {
        // Specimen with poor quality (Specimen 6) triggers non-punitive retake loop
        this.showRetakeModal({
          retakePrompt: 'A3a: Capture Quality Check Required',
          guidanceAdvice: docDataToScreen.qualityResult.failureReason ||
            `Laplacian blur variance (${docDataToScreen.qualityResult.laplacianVariance || 38}) or glare (${docDataToScreen.qualityResult.overexposedPct || 22}%) failed quality gate. Hold steady and realign.`
        });
        return;
      }

      // Generate local scan record and snapshot blob if not already generated (Step 2)
      if (!this.currentScanId) {
        const recordId = crypto.randomUUID ? crypto.randomUUID() :
          'scan-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9);
        this.currentScanId = recordId;

        try {
          const canvas = this.lastCapturedCanvas || document.createElement('canvas');
          if (!this.lastCapturedCanvas) {
            canvas.width = 640;
            canvas.height = 400;
            const ctx = canvas.getContext('2d');
            ctx.fillStyle = '#151e34';
            ctx.fillRect(0, 0, 640, 400);
            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 16px monospace';
            ctx.fillText(`SPECIMEN: ${docDataToScreen.title || 'TEST DOC'}`, 24, 40);
            ctx.fillStyle = '#e2e8f0';
            ctx.font = '14px sans-serif';
            ctx.fillText(`Traveler: ${docDataToScreen.visualFields?.fullName || 'Traveler'}`, 24, 80);
            ctx.fillText(`Doc Number: ${docDataToScreen.visualFields?.documentNumber || 'TEST'}`, 24, 110);
            this.lastCapturedCanvas = canvas;
          }

          const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.85));
          if (blob) {
            const activeOfficer = AuthManager.getActiveSession();
            await dbInstance.saveScanRecord({
              record_id: recordId,
              image_blob: blob,
              checkpoint_id: CONFIG.OFFICER?.checkpoint || 'CP-04-NORTH',
              officer_id: activeOfficer?.id || CONFIG.OFFICER?.id || 'SSB-OFFICER',
              timestamp: new Date().toISOString(),
              image_path: `indexeddb://image_blobs/${recordId}`,
              document_type: officerDocType || docDataToScreen.document_type || 'passport',
              status: 'captured'
            });
            await dbInstance.saveImageBlob(recordId, blob, docDataToScreen.qualityResult || { passed: true, engine: 'specimen' });
            console.log(`[Step 2] ✅ Specimen record stored in IndexedDB (Dexie.js): ${recordId} [image_blob: ${(blob.size / 1024).toFixed(1)} KB, status: 'captured']`);
          }
        } catch (specErr) {
          console.warn('[Step 2] Specimen local save warning:', specErr);
        }
      }
    }

    // Step A2: Ledger Lookup (Check document history in cryptographic ledger)
    const docNumber = docDataToScreen.visualFields?.documentNumber;
    const routing = await LedgerRouter.evaluatePathway(docNumber);

    // Branch 1: Found, approved with clean history -> Column C Fast Lane
    if (routing.pathway === 'FAST_LANE') {
      this.showToast('⚡ Verified Frequent Crosser · Routing to Column C Fast Lane');
      await this.renderFastLaneScreen(docDataToScreen, routing);
      this.navigateTo('fastlane');
      return;
    }

    // Branch 2: Found, flagged in prior records -> Column B Direct Officer Review
    if (routing.pathway === 'OFFICER_REVIEW') {
      this.showToast('⚠️ Prior Alert Detected in Ledger · Direct Officer Adjudication');
      const flagResult = {
        decision: 'ESCALATED_SECONDARY',
        riskScore: 68,
        confidence: 65,
        traveler: {
          fullName: docDataToScreen.visualFields?.fullName || 'VIKRAM SINGH',
          documentNumber: docNumber,
          nationality: docDataToScreen.visualFields?.nationality || 'IND',
          dateOfBirth: docDataToScreen.visualFields?.dateOfBirth || '1987-03-21',
          expiryDate: docDataToScreen.visualFields?.expiryDate || '2032-09-14',
          sex: docDataToScreen.visualFields?.sex || 'M',
          documentType: docDataToScreen.visualFields?.documentType || 'PASSPORT',
          photoUrl: docDataToScreen.photoUrl
        },
        anomalies: [
          {
            module: 'Column B: Ledger History Alert',
            severity: 'CRITICAL',
            reason: `Traveler flagged in prior checkpoint record (${routing.history.count} previous crossings). Mandatory officer adjudication required.`,
            penalty: 45
          }
        ],
        stages: {}
      };
      this.currentPipelineResult = flagResult;
      this.renderFlaggedScreen(flagResult);
      this.navigateTo('flagged');
      return;
    }

    // Branch 3: Not found -> Column A Full 7-Stage Detection Pipeline
    this.navigateTo('processing');
    this.runPipelineStages(docDataToScreen);
  }

  // --- COLUMN C: FREQUENT-CROSSER FAST LANE CONTROLLER ---

  async renderFastLaneScreen(docData, routing) {
    this.activeFastLaneDoc = docData;
    this.activeFastLaneRouting = routing;

    const photoEl = document.getElementById('fastlane-traveler-photo');
    const nameEl = document.getElementById('fastlane-traveler-name');
    const docNumEl = document.getElementById('fastlane-doc-num');
    const natEl = document.getElementById('fastlane-nat');
    const typeEl = document.getElementById('fastlane-doc-type');
    const badgeEl = document.getElementById('fastlane-crossings-badge');
    const matchStatusEl = document.getElementById('fastlane-match-status');
    const matchProgressEl = document.getElementById('fastlane-match-progress');
    const resultBox = document.getElementById('fastlane-result-box');
    const fallbackBox = document.getElementById('fastlane-fallback-box');
    const admitBtn = document.getElementById('btn-fastlane-admit');

    const vf = docData.visualFields || {};
    if (photoEl && docData.photoUrl) photoEl.src = docData.photoUrl;
    if (nameEl) nameEl.textContent = vf.fullName || 'RAMESH THAPA';
    if (docNumEl) docNumEl.textContent = vf.documentNumber || 'NP-FC-991204';
    if (natEl) natEl.textContent = `${vf.nationality || 'NPL'} · Nepal (Verified Local Commuter)`;
    if (typeEl) typeEl.textContent = vf.documentType || 'BORDER PERMIT';
    if (badgeEl) badgeEl.textContent = `${routing.history.count || 14} VERIFIED CROSSINGS`;

    // Step C1: Quick Face Match simulation
    if (matchStatusEl) {
      matchStatusEl.innerHTML = '<span class="material-symbols-outlined text-[16px] animate-spin text-primary">progress_activity</span><span>Comparing Live Face Biometrics...</span>';
    }
    if (matchProgressEl) matchProgressEl.style.width = '25%';
    if (resultBox) resultBox.classList.add('hidden');
    if (fallbackBox) fallbackBox.classList.add('hidden');
    if (admitBtn) admitBtn.disabled = true;

    await new Promise(r => setTimeout(r, 650));

    const faceMatch = docData.simulatedFaceMatch !== undefined ? docData.simulatedFaceMatch : 97.2;
    if (matchProgressEl) matchProgressEl.style.width = `${Math.min(100, Math.round(faceMatch))}%`;

    if (faceMatch >= 80) {
      // Step C2: Fast-Lane Auto-Pass
      if (matchStatusEl) {
        matchStatusEl.className = 'text-xs font-bold text-secondary flex items-center gap-1';
        matchStatusEl.innerHTML = `<span class="material-symbols-outlined text-[16px]">check_circle</span><span>${faceMatch.toFixed(1)}% Biometric Match (Threshold 80%)</span>`;
      }
      if (resultBox) resultBox.classList.remove('hidden');
      if (fallbackBox) fallbackBox.classList.add('hidden');
      if (admitBtn) {
        admitBtn.disabled = false;
        admitBtn.innerHTML = '<span class="material-symbols-outlined text-[22px]">how_to_reg</span><span>Admit Frequent Crosser &amp; Open Gate</span>';
      }
    } else {
      // Fallback to Full Pipeline
      if (matchStatusEl) {
        matchStatusEl.className = 'text-xs font-bold text-tertiary flex items-center gap-1';
        matchStatusEl.innerHTML = `<span class="material-symbols-outlined text-[16px]">warning</span><span>${faceMatch.toFixed(1)}% Match (Below 80% Fast-Lane Threshold)</span>`;
      }
      if (resultBox) resultBox.classList.add('hidden');
      if (fallbackBox) fallbackBox.classList.remove('hidden');
      if (admitBtn) admitBtn.disabled = true;
    }
  }

  async admitFrequentCrosser() {
    if (!this.activeFastLaneDoc) return;
    const docData = this.activeFastLaneDoc;
    const vf = docData.visualFields || {};
    const priorCount = (this.activeFastLaneRouting && this.activeFastLaneRouting.history)
      ? this.activeFastLaneRouting.history.count
      : 14;

    const activeOfficer = AuthManager.getActiveSession();
    const officerId = activeOfficer ? activeOfficer.id : CONFIG.OFFICER.id;

    const block = await ledgerInstance.appendDecision({
      docId: vf.documentNumber || 'NP-FC-991204',
      travelerName: vf.fullName || 'RAMESH THAPA',
      nationality: vf.nationality || 'NPL',
      docType: vf.documentType || 'BORDER_PERMIT',
      riskScore: 8,
      decision: 'AUTO_APPROVED',
      pathway: 'FAST_LANE',
      crossingCount: priorCount + 1,
      officerId: officerId,
      reasons: [`Fast-lane biometric face match verified (${(docData.simulatedFaceMatch || 97.2).toFixed(1)}%). Crossing #${priorCount + 1} logged.`],
      syncStatus: syncInstance.isOnline() ? 'SYNCED' : 'LOCAL PENDING'
    });

    this.showToast(`⚡ FAST-LANE CLEARANCE RECORD #${block.index} LOGGED`);
    this.navigateTo('capture');
  }

  async runPipelineStages(documentData) {
    const elapsedEl = document.getElementById('process-elapsed-time');
    const docRefEl = document.getElementById('process-doc-ref');
    if (docRefEl) {
      docRefEl.textContent = `DOC_REF: #${documentData.visualFields?.documentNumber || '9942-TXB'}`;
    }

    const startTime = Date.now();
    const timer = setInterval(() => {
      if (elapsedEl) {
        const sec = ((Date.now() - startTime) / 1000).toFixed(2);
        elapsedEl.textContent = `${sec}s ELAPSED`;
      }
    }, 100);

    const stepElements = {
      1: document.getElementById('stage-step-1'),
      2: document.getElementById('stage-step-2'),
      3: document.getElementById('stage-step-3'),
      4: document.getElementById('stage-step-4'),
      5: document.getElementById('stage-step-5'),
      6: document.getElementById('stage-step-6'),
      7: document.getElementById('stage-step-7'),
      8: document.getElementById('stage-step-8')
    };

    const updateStageUI = (stageNum, status, detail) => {
      const stepEl = stepElements[stageNum];
      if (!stepEl) return;

      const badge = stepEl.querySelector('.stage-badge');
      const desc = stepEl.querySelector('.stage-desc');
      const icon = stepEl.querySelector('.stage-icon');

      if (status === 'RUNNING') {
        stepEl.classList.add('bg-surface-container-highest/60');
        if (badge) {
          badge.textContent = 'PROCESSING...';
          badge.className = 'stage-badge font-label-data text-code-sm text-tertiary uppercase animate-pulse';
        }
        if (icon) icon.className = 'stage-icon material-symbols-outlined text-[16px] text-tertiary animate-spin';
      } else if (status === 'PASSED') {
        stepEl.classList.remove('bg-surface-container-highest/60');
        if (badge) {
          badge.textContent = 'PASS';
          badge.className = 'stage-badge font-label-data text-code-sm text-secondary uppercase';
        }
        if (icon) {
          icon.textContent = 'check';
          icon.className = 'stage-icon material-symbols-outlined text-[16px] text-secondary';
        }
      } else if (status === 'FLAGGED') {
        stepEl.classList.remove('bg-surface-container-highest/60');
        if (badge) {
          badge.textContent = 'ANOMALY';
          badge.className = 'stage-badge font-label-data text-code-sm text-tertiary uppercase font-bold';
        }
        if (icon) {
          icon.textContent = 'warning';
          icon.className = 'stage-icon material-symbols-outlined text-[16px] text-tertiary';
        }
      }
      if (desc && detail) desc.textContent = detail;
    };

    try {
      const pipelineStartTime = Date.now();
      const result = await ForensicEngine.executePipeline(documentData, ({ stage, name, status, detail }) => {
        updateStageUI(stage, status, detail);
      });
      const processingTimeMs = Date.now() - pipelineStartTime;

      clearInterval(timer);
      this.currentPipelineResult = result;

      // ── UPDATE LOCAL INDEXEDDB SCAN STATUS ──
      // The scan record and image blob were already saved at shutter press
      // (Phase 1). Now update the status to reflect pipeline completion.
      if (this.currentScanId) {
        try {
          const finalStatus = result.decision === 'AUTO_APPROVED' ? 'decided' : 'tamper_checked';
          await dbInstance.updateScanStatus(this.currentScanId, finalStatus);

          // Save detection scores locally
          await dbInstance.saveDetectionScores({
            record_id: this.currentScanId,
            tamper_score: result.stages?.tamperDetection?.score ?? 0,
            face_match_score: result.stages?.faceMatch?.score ?? 0,
            hidden_text_flag: result.stages?.hiddenTextDetection?.detected ?? false,
            risk_score: result.riskScore ?? 0,
            decision: result.decision || 'UNKNOWN'
          });

          // Save extracted fields locally (Generic schema across passport, national_id, visa)
          const ef = result.extractedFields || {};
          const docType = documentData.document_type || ef.document_type || (result.traveler && result.traveler.documentType) || this.selectedDocType || 'passport';
          const rawMrz = ef.mrz_raw !== undefined ? ef.mrz_raw : ((documentData.mrzLines && documentData.mrzLines.length > 0) ? documentData.mrzLines.join('\n') : null);
          const extraFields = ef.extra_fields || documentData.extra_fields || (result.traveler && result.traveler.extraFields) || {};

          const extractedRecord = {
            record_id: this.currentScanId,
            document_type: docType,
            name: ef.name || result.traveler?.fullName || documentData.visualFields?.fullName || 'UNKNOWN',
            date_of_birth: ef.date_of_birth || result.traveler?.dateOfBirth || documentData.visualFields?.dateOfBirth,
            document_number: ef.document_number || result.traveler?.documentNumber || documentData.visualFields?.documentNumber,
            nationality: ef.nationality || result.traveler?.nationality || documentData.visualFields?.nationality,
            gender: ef.gender || result.traveler?.sex || documentData.visualFields?.sex,
            issue_date: ef.issue_date || documentData.issueDate || '2020-01-01',
            expiry_date: ef.expiry_date || result.traveler?.expiryDate || documentData.visualFields?.expiryDate,
            mrz_raw: rawMrz,
            extra_fields: extraFields
          };
          this.currentExtractedRecord = extractedRecord;

          await dbInstance.saveExtractedFields(extractedRecord);

          // Step 5: Save validation results locally (ICAO 9303, Date Logic & Photo Check)
          const valPassed = result.validation_passed !== undefined
            ? result.validation_passed
            : (result.stages?.mrz?.passed !== false && result.stages?.consistency?.passed !== false && result.stages?.logic?.passed !== false);

          const failureReasons = result.failure_reasons || (result.anomalies || []).map(a => `${a.module}: ${a.description || a.reason || ''}`);

          await dbInstance.saveValidationResults({
            record_id: this.currentScanId,
            validation_passed: valPassed,
            mrz_checksum_passed: result.stages?.mrz?.passed ?? true,
            field_format_passed: result.stages?.consistency?.passed ?? true,
            date_logic_passed: result.stages?.logic?.passed ?? true,
            photo_validation_passed: result.stages?.photoValidation?.passed ?? true,
            failure_reasons: failureReasons
          });

          console.log(`[Step 5] ✅ Local scan ${this.currentScanId} validation recorded: passed=${valPassed}, reasons=${failureReasons.length}`);
        } catch (localErr) {
          console.warn('[Step 5] Local status update warning:', localErr);
        }
      }

      // ── SYNC TO BACKEND (NON-BLOCKING, BEST-EFFORT) ──
      // Use the pre-captured canvas saved at shutter press (not the analysis canvas)
      const captureCanvas = this.lastCapturedCanvas || document.getElementById('camera-canvas');
      const scanPayload = {
        ...documentData,
        extracted_fields: this.currentExtractedRecord
      };
      const scanResult = await BackendAPI.saveScan(scanPayload, captureCanvas);
      const targetScanId = (scanResult && scanResult.scan_id) ? scanResult.scan_id : this.currentScanId;
      if (this.currentExtractedRecord && targetScanId) {
        await BackendAPI.saveExtractedFields(targetScanId, this.currentExtractedRecord);
      }
      if (scanResult && scanResult.scan_id) {
        // Save analysis results linked to this scan
        await BackendAPI.saveAnalysis(scanResult.scan_id, result, processingTimeMs);
        console.log(`[DB] ✅ Scan + Extracted Fields + Analysis synced to backend SQLite (${(processingTimeMs/1000).toFixed(2)}s pipeline)`);
      } else {
        console.log('[DB] ⚠️ Backend unavailable — scan persisted in local IndexedDB only');
      }

      // Small pause to let officer perceive completion
      await new Promise(res => setTimeout(res, 600));

      if (result.decision === 'AUTO_APPROVED') {
        this.renderApprovedScreen(result);
        this.navigateTo('approved');
      } else {
        this.renderFlaggedScreen(result);
        this.navigateTo('flagged');
      }
    } catch (e) {
      clearInterval(timer);
      console.error('Forensic pipeline failure:', e);
      alert('Local screening engine encountered an error. Check console.');
      this.navigateTo('capture');
    }
  }

  // --- RESULT APPROVED SCREEN ---

  renderApprovedScreen(result) {
    const nameEl = document.getElementById('approved-traveler-name');
    const docNumEl = document.getElementById('approved-doc-num');
    const natEl = document.getElementById('approved-nat');
    const dobEl = document.getElementById('approved-dob');
    const expEl = document.getElementById('approved-exp');
    const sexEl = document.getElementById('approved-sex');
    const typeEl = document.getElementById('approved-doc-type');
    const scoreEl = document.getElementById('approved-risk-score');
    const confEl = document.getElementById('approved-confidence-pct');
    const photoEl = document.getElementById('approved-photo');
    const blockRefEl = document.getElementById('approved-block-ref');

    const t = result.traveler;
    if (nameEl) nameEl.textContent = t.fullName;
    if (docNumEl) docNumEl.textContent = t.documentNumber;
    if (natEl) natEl.textContent = `${t.nationality} (${CONFIG.ICAO_COUNTRIES[t.nationality] || 'ICAO'})`;
    if (dobEl) dobEl.textContent = t.dateOfBirth;
    if (expEl) expEl.textContent = t.expiryDate;
    if (sexEl) sexEl.textContent = t.sex === 'M' ? 'MALE' : (t.sex === 'F' ? 'FEMALE' : t.sex);
    if (typeEl) typeEl.textContent = t.documentType;
    if (scoreEl) scoreEl.textContent = `${result.riskScore} / 100`;
    if (confEl) confEl.textContent = `${result.confidence}%`;
    if (photoEl && t.photoUrl) photoEl.src = t.photoUrl;

    if (blockRefEl) {
      blockRefEl.textContent = `IMMUTABLE HASH READY // SHA-256 ANCHOR`;
    }

    // Step 4: Populate Extracted Fields Inspection Panel side-by-side with document image
    if (this.currentExtractedRecord) {
      this.renderExtractedFieldsInspection(this.currentExtractedRecord, this.lastCapturedCanvas || t.photoUrl, 'APPROVED');
    }
  }

  async confirmAdmitPassenger() {
    if (!this.currentPipelineResult) return;
    const r = this.currentPipelineResult;
    const t = r.traveler;

    const block = await ledgerInstance.appendDecision({
      docId: t.documentNumber,
      travelerName: t.fullName,
      nationality: t.nationality,
      docType: t.documentType,
      riskScore: r.riskScore,
      decision: 'AUTO_APPROVED',
      officerId: CONFIG.OFFICER.id,
      reasons: ['High confidence biometric & cryptographic clearance.'],
      syncStatus: syncInstance.isOnline() ? 'SYNCED' : 'LOCAL PENDING'
    });

    // ── SAVE DECISION TO SQLITE ──
    if (this.currentScanId) {
      await BackendAPI.saveDecision(this.currentScanId, {
        decision: 'AUTO_APPROVED',
        officer_id: CONFIG.OFFICER.id,
        officer_notes: 'High confidence biometric & cryptographic clearance.',
        reasons: ['Auto-approved by DocuShield pipeline.'],
        risk_score: r.riskScore,
        ledger_block_index: block.index,
        ledger_hash: block.hash,
      });
    }

    // Notify background sync
    syncInstance.handleNetworkChange();

    this.showToast(`CLEARANCE RECORD #${block.index} WRITTEN TO LEDGER & DATABASE`);
    this.navigateTo('dashboard');
  }

  // --- RESULT FLAGGED SCREEN ---

  renderFlaggedScreen(result) {
    const nameEl = document.getElementById('flagged-traveler-name');
    const docNumEl = document.getElementById('flagged-doc-num');
    const natEl = document.getElementById('flagged-nat');
    const scoreEl = document.getElementById('flagged-risk-score');
    const photoEl = document.getElementById('flagged-photo');
    const listEl = document.getElementById('flagged-anomalies-list');

    const t = result.traveler;
    if (nameEl) nameEl.textContent = t.fullName;
    if (docNumEl) docNumEl.textContent = t.documentNumber;
    if (natEl) natEl.textContent = `${t.nationality} (${CONFIG.ICAO_COUNTRIES[t.nationality] || 'ICAO'})`;
    if (scoreEl) scoreEl.textContent = `${result.riskScore}`;
    if (photoEl && t.photoUrl) photoEl.src = t.photoUrl;

    if (listEl) {
      listEl.innerHTML = result.anomalies.map(a => `
        <div class="p-3.5 rounded-2xl bg-surface-container-high border-l-4 border-tertiary flex flex-col gap-1.5 border border-outline/20 shadow-sm">
          <div class="flex items-center justify-between">
            <span class="text-xs font-bold text-tertiary uppercase tracking-wide">${a.module}</span>
            <span class="font-mono text-xs text-tertiary font-bold px-2 py-0.5 rounded-md bg-tertiary/15">+${a.impact} RISK</span>
          </div>
          <p class="text-xs text-on-surface leading-relaxed">${a.description}</p>
        </div>
      `).join('');
    }

    // Step 4: Populate Extracted Fields Inspection Panel side-by-side with flagged document image
    if (this.currentExtractedRecord) {
      this.renderExtractedFieldsInspection(this.currentExtractedRecord, this.lastCapturedCanvas || t.photoUrl, 'FLAGGED');
    }
  }

  async escalateToSecondary() {
    if (!this.currentPipelineResult) return;
    const r = this.currentPipelineResult;
    const t = r.traveler;

    const block = await ledgerInstance.appendDecision({
      docId: t.documentNumber,
      travelerName: t.fullName,
      nationality: t.nationality,
      docType: t.documentType,
      riskScore: r.riskScore,
      decision: 'ESCALATED_SECONDARY',
      officerId: CONFIG.OFFICER.id,
      reasons: r.anomalies.map(a => `${a.module}: ${a.description}`),
      syncStatus: syncInstance.isOnline() ? 'SYNCED' : 'LOCAL PENDING'
    });

    // ── SAVE ESCALATION TO SQLITE ──
    if (this.currentScanId) {
      await BackendAPI.saveDecision(this.currentScanId, {
        decision: 'ESCALATED_SECONDARY',
        officer_id: CONFIG.OFFICER.id,
        reasons: r.anomalies.map(a => `${a.module}: ${a.description}`),
        risk_score: r.riskScore,
        ledger_block_index: block.index,
        ledger_hash: block.hash,
      });
    }

    // Add to review queue
    this.reviewQueue.unshift({
      id: `REV-${1000 + block.index}`,
      travelerName: t.fullName,
      nationality: t.nationality,
      docNumber: t.documentNumber,
      docType: t.documentType,
      riskScore: r.riskScore,
      timestamp: new Date().toISOString(),
      anomalies: r.anomalies.map(a => a.description),
      status: 'PENDING',
      syncStatus: block.syncStatus,
      photoUrl: t.photoUrl
    });
    this.saveQueue();

    syncInstance.handleNetworkChange();
    this.showToast(`ESCALATED: TRAVELER ADDED TO REVIEW QUEUE & DATABASE (BLOCK #${block.index})`);
    this.navigateTo('queue');
  }

  async overrideWithNotes() {
    const notes = prompt('Enter mandatory officer justification note for override:', 'Manual physical inspection of UV watermark & passport booklet verified genuine.');
    if (!notes) return;

    const r = this.currentPipelineResult;
    const t = r.traveler;

    const block = await ledgerInstance.appendDecision({
      docId: t.documentNumber,
      travelerName: t.fullName,
      nationality: t.nationality,
      docType: t.documentType,
      riskScore: r.riskScore,
      decision: 'OFFICER_OVERRIDE',
      officerId: CONFIG.OFFICER.id,
      reasons: [`OVERRIDE NOTE: ${notes}`, ...r.anomalies.map(a => a.description)],
      syncStatus: syncInstance.isOnline() ? 'SYNCED' : 'LOCAL PENDING'
    });

    // ── SAVE OVERRIDE TO SQLITE ──
    if (this.currentScanId) {
      await BackendAPI.saveDecision(this.currentScanId, {
        decision: 'OFFICER_OVERRIDE',
        officer_id: CONFIG.OFFICER.id,
        officer_notes: notes,
        reasons: [`OVERRIDE NOTE: ${notes}`, ...r.anomalies.map(a => a.description)],
        risk_score: r.riskScore,
        ledger_block_index: block.index,
        ledger_hash: block.hash,
      });
    }

    syncInstance.handleNetworkChange();
    this.showToast(`OVERRIDE RECORDED IN LEDGER & DATABASE (BLOCK #${block.index})`);
    this.navigateTo('dashboard');
  }

  // --- REVIEW QUEUE SCREEN ---

  renderReviewQueue() {
    const listEl = document.getElementById('queue-items-list');
    const counterEl = document.getElementById('queue-pending-count');
    if (!listEl) return;

    const pending = this.reviewQueue.filter(item => item.status === 'PENDING');
    if (counterEl) counterEl.textContent = `${pending.length} CASES REQUIRING ATTENTION`;

    if (this.reviewQueue.length === 0) {
      listEl.innerHTML = `
        <div class="p-8 text-center text-on-surface-variant flex flex-col items-center gap-2">
          <span class="material-symbols-outlined text-[36px] text-outline">done_all</span>
          <p class="font-title-sm">All travelers reviewed. No pending queue items.</p>
        </div>
      `;
      return;
    }

    listEl.innerHTML = this.reviewQueue.map((item, idx) => `
      <div class="p-4 rounded-2xl bg-surface-container hover:bg-surface-container-high transition-all flex flex-col gap-2.5 border border-outline/20 shadow-sm">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <img src="${item.photoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}" class="w-12 h-12 rounded-xl object-cover border border-outline/30 shadow-sm" />
            <div class="flex flex-col">
              <span class="font-bold text-sm text-on-surface">${item.travelerName}</span>
              <span class="text-xs text-on-surface-variant font-mono mt-0.5">${item.docNumber} · ${item.nationality} · ${item.docType}</span>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="px-2.5 py-0.5 rounded-full font-mono text-xs font-bold ${
              item.riskScore > 50 ? 'bg-error/15 text-error border border-error/30' : 'bg-tertiary/15 text-tertiary border border-tertiary/30'
            }">RISK ${item.riskScore}</span>
            <span class="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full ${
              item.syncStatus === 'SYNCED' ? 'bg-secondary/15 text-secondary' : 'bg-tertiary/15 text-tertiary'
            }">${item.syncStatus}</span>
          </div>
        </div>
        <div class="bg-surface-container-high/60 p-2.5 rounded-xl text-xs text-on-surface-variant space-y-1 border border-outline/10">
          ${item.anomalies.map(anom => `<div class="flex items-start gap-1.5"><span class="text-tertiary font-bold">•</span><span class="text-on-surface">${anom}</span></div>`).join('')}
        </div>
        <div class="flex items-center justify-between pt-1 text-xs">
          <span class="text-outline font-medium">${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <div class="flex gap-2">
            ${item.status === 'PENDING' ? `
              <button data-idx="${idx}" class="queue-adjudicate-btn px-4 py-1.5 rounded-xl bg-secondary text-white font-bold text-xs uppercase hover:bg-secondary-container transition-all shadow-sm">
                Clear &amp; Admit
              </button>
            ` : `
              <span class="text-xs text-secondary font-bold uppercase flex items-center gap-1">
                <span class="material-symbols-outlined text-[16px]">check</span>
                <span>Adjudicated</span>
              </span>
            `}
          </div>
        </div>
      </div>
    `).join('');

    listEl.querySelectorAll('.queue-adjudicate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.idx, 10);
        this.resolveQueueItem(idx);
      });
    });
  }

  async resolveQueueItem(idx) {
    const item = this.reviewQueue[idx];
    if (!item) return;

    item.status = 'ADJUDICATED';
    this.saveQueue();

    await ledgerInstance.appendDecision({
      docId: item.docNumber,
      travelerName: item.travelerName,
      nationality: item.nationality,
      docType: item.docType,
      riskScore: item.riskScore,
      decision: 'OFFICER_OVERRIDE',
      officerId: CONFIG.OFFICER.id,
      reasons: ['Secondary interview passed. Identity cleared by duty supervisor.'],
      syncStatus: syncInstance.isOnline() ? 'SYNCED' : 'LOCAL PENDING'
    });

    this.showToast(`TRAVELER ${item.travelerName} ADJUDICATED & ADMITTED`);
    this.renderReviewQueue();
  }

  // --- AUDIT LOG SCREEN ---

  async renderAuditLog() {
    const listEl = document.getElementById('audit-blocks-list');
    const totalBlocksEl = document.getElementById('audit-total-blocks');
    if (!listEl) return;

    const blocks = await ledgerInstance.getBlocks();
    if (totalBlocksEl) totalBlocksEl.textContent = `${blocks.length} TOTAL IMMUTABLE RECORDS`;

    listEl.innerHTML = blocks.map(b => {
      let pathwayBadge = '';
      if (b.pathway === 'FAST_LANE') {
        pathwayBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-primary/15 text-primary border border-primary/30">⚡ FAST LANE (#${b.crossingCount || 1})</span>`;
      } else if (b.pathway === 'OFFICER_REVIEW') {
        pathwayBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-tertiary/15 text-tertiary border border-tertiary/30">⚠️ OFFICER ADJUDICATION</span>`;
      } else {
        pathwayBadge = `<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-secondary/15 text-secondary border border-secondary/30">🛡️ 7-STAGE PIPELINE</span>`;
      }

      return `
      <div class="p-4 rounded-2xl bg-surface-container border border-outline/20 flex flex-col gap-2.5 shadow-sm">
        <div class="flex items-center justify-between pb-2 border-b border-outline/15">
          <div class="flex items-center gap-2">
            <span class="text-primary font-bold font-mono text-xs">RECORD #${b.index}</span>
            <span class="text-outline">·</span>
            <span class="text-on-surface font-bold text-xs">${b.travelerName}</span>
            ${pathwayBadge}
          </div>
          <span class="px-2.5 py-0.5 rounded-full text-[10px] font-semibold uppercase ${
            b.syncStatus === 'SYNCED' ? 'bg-secondary/15 text-secondary' : 'bg-tertiary/15 text-tertiary animate-pulse'
          }">${b.syncStatus}</span>
        </div>
        <div class="grid grid-cols-2 gap-2.5 text-xs py-1">
          <div class="p-2 rounded-xl bg-surface-container-high/60">
            <span class="text-outline text-[10px] uppercase block font-medium">Document ID</span>
            <span class="text-on-surface font-semibold font-mono">${b.docId} (${b.nationality})</span>
          </div>
          <div class="p-2 rounded-xl bg-surface-container-high/60">
            <span class="text-outline text-[10px] uppercase block font-medium">Decision</span>
            <span class="font-bold ${
              b.decision === 'AUTO_APPROVED' ? 'text-secondary' : (b.decision === 'OFFICER_OVERRIDE' ? 'text-primary' : 'text-tertiary')
            }">${b.decision}</span>
          </div>
          <div class="p-2 rounded-xl bg-surface-container-high/60">
            <span class="text-outline text-[10px] uppercase block font-medium">Duty Officer</span>
            <span class="text-on-surface font-medium">${b.officerId}</span>
          </div>
          <div class="p-2 rounded-xl bg-surface-container-high/60">
            <span class="text-outline text-[10px] uppercase block font-medium">Timestamp (UTC)</span>
            <span class="text-on-surface font-mono text-[11px]">${new Date(b.timestamp).toISOString().replace('T', ' ').substring(0, 19)}</span>
          </div>
        </div>
        <div class="bg-surface-container-high/80 p-2.5 rounded-xl flex flex-col gap-1 text-[11px] font-mono break-all border border-outline/10">
          <div class="flex items-center justify-between text-on-surface-variant">
            <span class="text-outline text-[10px]">SHA-256:</span>
            <span class="text-primary font-bold">${b.hash.substring(0, 20)}...${b.hash.substring(44)}</span>
          </div>
          <div class="flex items-center justify-between text-[10px] text-outline">
            <span>CHAIN PREV:</span>
            <span>${b.prevHash.substring(0, 18)}...</span>
          </div>
        </div>
      </div>
    `;
    }).join('');
  }

  async verifyLedgerIntegrity() {
    const result = await ledgerInstance.verifyChainIntegrity();
    const modal = document.getElementById('verify-modal');
    const contentEl = document.getElementById('verify-modal-content');
    if (!modal || !contentEl) return;

    if (result.isValid) {
      contentEl.innerHTML = `
        <div class="flex flex-col items-center text-center gap-3 py-2">
          <div class="w-12 h-12 rounded-full bg-secondary/20 flex items-center justify-center text-secondary">
            <span class="material-symbols-outlined text-[28px]">verified</span>
          </div>
          <h3 class="font-headline-sm text-secondary uppercase font-bold">100% Cryptographically Intact</h3>
          <p class="font-body-sm text-on-surface-variant">
            Verified all <strong>${result.totalBlocks} blocks</strong> from Genesis block to latest terminal head.
            Zero hash tampering or parent linkage broken.
          </p>
          <div class="p-2 rounded bg-surface-container-lowest font-mono text-xs text-primary break-all w-full text-left">
            HEAD HASH: ${result.headHash}
          </div>
        </div>
      `;
    } else {
      contentEl.innerHTML = `
        <div class="flex flex-col items-center text-center gap-3 py-2">
          <div class="w-12 h-12 rounded-full bg-error-container flex items-center justify-center text-error">
            <span class="material-symbols-outlined text-[28px]">gpp_maybe</span>
          </div>
          <h3 class="font-headline-sm text-error uppercase font-bold">Integrity Discrepancy Found</h3>
          <p class="font-body-sm text-on-surface">
            ${result.reason}
          </p>
        </div>
      `;
    }

    modal.classList.remove('hidden');
  }

  // --- DASHBOARD METRICS ---

  async renderDashboardMetrics() {
    const blocks = await ledgerInstance.getBlocks();
    const totalCount = blocks.length - 1; // exclude genesis
    const approvedCount = blocks.filter(b => b.decision === 'AUTO_APPROVED' || b.decision === 'OFFICER_OVERRIDE').length;
    const flaggedCount = blocks.filter(b => b.decision === 'ESCALATED_SECONDARY').length;

    const totalEl = document.getElementById('dash-total-scanned');
    const approvedEl = document.getElementById('dash-approved-count');
    const flaggedEl = document.getElementById('dash-flagged-count');

    if (totalEl) totalEl.textContent = String(Math.max(342, 342 + totalCount));
    if (approvedEl) approvedEl.textContent = String(Math.max(319, 319 + approvedCount));
    if (flaggedEl) flaggedEl.textContent = String(Math.max(18, 18 + flaggedCount));
  }

  // --- PROFILE SCREEN ---

  renderProfile() {
    this.updateHardwareDiagnostics();

    const toggleBtn = document.getElementById('network-toggle-btn');
    const statusText = document.getElementById('network-sim-status');
    if (!toggleBtn || !statusText) return;

    if (syncInstance.simulatedOffline) {
      statusText.textContent = 'SIMULATING DISCONNECTED (OFFLINE MODE)';
      statusText.className = 'font-label-data text-code-sm text-tertiary';
      toggleBtn.textContent = 'SWITCH TO ONLINE AUTO-SYNC';
      toggleBtn.className = 'w-full py-2.5 rounded-lg bg-secondary text-on-secondary font-title-sm text-sm font-semibold uppercase hover:bg-secondary/90 transition-all';
    } else {
      statusText.textContent = 'NETWORK ONLINE (AUTO-SYNC ACTIVE)';
      statusText.className = 'font-label-data text-code-sm text-secondary';
      toggleBtn.textContent = 'FORCE OFFLINE (TEST STORE & FORWARD)';
      toggleBtn.className = 'w-full py-2.5 rounded-lg bg-surface-container-highest text-on-surface font-title-sm text-sm font-semibold uppercase hover:bg-surface-container-high transition-all';
    }
  }

  // --- ADMIN CONSOLE & SECTOR MANAGEMENT ---

  renderAdminRoster() {
    const listEl = document.getElementById('admin-officers-list');
    const countEl = document.getElementById('admin-roster-count');
    const totalEl = document.getElementById('admin-stat-total');
    const activeEl = document.getElementById('admin-stat-active');
    const suspendedEl = document.getElementById('admin-stat-suspended');
    const threatBadge = document.getElementById('admin-threat-badge');

    if (!listEl) return;

    const allOfficers = AuthManager.getOfficersFromStorage();
    const config = AuthManager.getSectorConfig();

    // Update KPI badges
    const totalCount = allOfficers.length;
    const activeCount = allOfficers.filter(o => o.status === 'ACTIVE').length;
    const suspendedCount = allOfficers.filter(o => o.status === 'SUSPENDED').length;

    if (totalEl) totalEl.textContent = totalCount;
    if (activeEl) activeEl.textContent = activeCount;
    if (suspendedEl) suspendedEl.textContent = suspendedCount;
    if (countEl) countEl.textContent = `${totalCount} Enrolled`;

    if (threatBadge) {
      threatBadge.textContent = `THREAT: ${config.threatLevel}`;
      if (config.threatLevel === 'CHARLIE') {
        threatBadge.className = 'px-2 py-0.5 rounded-full bg-error-container/40 text-error font-mono text-[9px] font-bold border border-error/50 animate-pulse';
      } else if (config.threatLevel === 'BRAVO') {
        threatBadge.className = 'px-2 py-0.5 rounded-full bg-tertiary/20 text-tertiary font-mono text-[9px] font-bold border border-tertiary/40';
      } else {
        threatBadge.className = 'px-2 py-0.5 rounded-full bg-secondary/20 text-secondary font-mono text-[9px] font-bold border border-secondary/30';
      }
    }

    // Filter by search query and status dropdown
    const searchQuery = (document.getElementById('admin-search-input')?.value || '').trim().toLowerCase();
    const statusFilter = document.getElementById('admin-filter-status')?.value || 'ALL';

    const officers = allOfficers.filter(o => {
      if (statusFilter !== 'ALL' && o.status !== statusFilter) return false;
      if (searchQuery) {
        const q = searchQuery;
        const matchName = (o.fullName || '').toLowerCase().includes(q);
        const matchId = (o.id || '').toLowerCase().includes(q);
        const matchStation = (o.checkpointName || o.checkpointId || '').toLowerCase().includes(q);
        const matchRank = (o.rank || '').toLowerCase().includes(q);
        return matchName || matchId || matchStation || matchRank;
      }
      return true;
    });

    if (officers.length === 0) {
      listEl.innerHTML = `
        <div class="p-8 text-center font-mono text-xs text-outline flex flex-col items-center gap-2">
          <span class="material-symbols-outlined text-3xl opacity-50">search_off</span>
          <span>No officer records matching your criteria.</span>
        </div>
      `;
      return;
    }

    listEl.innerHTML = officers.map(o => {
      const isActive = o.status === 'ACTIVE';
      const initials = (o.fullName || 'Officer').split(' ').map(n => n[0]).filter(Boolean).slice(0, 2).join('').toUpperCase() || 'OF';
      const enrolledDate = o.enrolledAt ? new Date(o.enrolledAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Verified';

      return `
        <div class="p-3.5 rounded-2xl bg-surface-container-high border border-outline/20 flex flex-col md:flex-row md:items-center justify-between gap-3 hover:border-outline/40 transition-all shadow-sm">
          <div class="flex items-start sm:items-center gap-3">
            <div class="w-11 h-11 rounded-xl bg-primary/15 border border-primary/30 flex items-center justify-center text-primary font-bold text-xs flex-shrink-0 mt-0.5 sm:mt-0">
              ${initials}
            </div>
            <div class="flex flex-col">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-bold text-xs text-on-surface">${o.fullName}</span>
                <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isActive ? 'bg-secondary/15 text-secondary border border-secondary/30' : 'bg-error/15 text-error border border-error/30'}">
                  ${o.status}
                </span>
                <span class="text-[11px] text-outline">Enrolled: ${enrolledDate}</span>
              </div>
              <div class="flex flex-wrap items-center gap-1.5 text-xs text-on-surface-variant mt-0.5">
                <span class="text-primary font-semibold font-mono">${o.id}</span>
                <span>•</span>
                <span>${o.rank}</span>
                <span>•</span>
                <span>${o.checkpointName || o.checkpointId}</span>
                ${o.badgeNumber ? `<span>• Badge: ${o.badgeNumber}</span>` : ''}
              </div>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-1.5 self-end md:self-center flex-shrink-0">
            <button type="button" class="btn-quick-login-officer px-3 py-1.5 rounded-xl bg-primary/15 hover:bg-primary/25 border border-primary/30 text-primary text-xs font-semibold transition-all flex items-center gap-1" data-officer-id="${o.id}" title="Login as this officer">
              <span class="material-symbols-outlined text-[15px]">login</span>
              <span>Login As</span>
            </button>

            <button type="button" class="btn-toggle-status px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${isActive ? 'border-error/30 text-error hover:bg-error/15' : 'border-secondary/30 text-secondary hover:bg-secondary/15'}" data-officer-id="${o.id}">
              ${isActive ? 'Suspend' : 'Activate'}
            </button>

            <button type="button" class="btn-open-reset-pin px-2.5 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-highest border border-outline/20 text-on-surface text-xs font-semibold transition-all flex items-center gap-1" data-officer-id="${o.id}" data-officer-name="${o.fullName}" title="Reset Terminal PIN">
              <span class="material-symbols-outlined text-[15px]">key</span>
              <span>PIN</span>
            </button>

            <button type="button" class="btn-open-edit-officer px-2.5 py-1.5 rounded-xl bg-surface-container hover:bg-surface-container-highest border border-outline/20 text-on-surface text-xs font-semibold transition-all flex items-center gap-1" data-officer-id="${o.id}" title="Edit officer details">
              <span class="material-symbols-outlined text-[15px]">edit</span>
              <span>Edit</span>
            </button>

            <button type="button" class="btn-delete-officer px-2.5 py-1.5 rounded-xl border border-error/20 text-error hover:bg-error/15 text-xs font-semibold transition-all" data-officer-id="${o.id}" title="Decommission officer badge">
              <span class="material-symbols-outlined text-[15px]">delete</span>
            </button>
          </div>
        </div>
      `;
    }).join('');

    this.bindAdminRosterActions(listEl);
  }

  bindAdminRosterActions(listEl) {
    // Toggle Status
    listEl.querySelectorAll('.btn-toggle-status').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.officerId;
        const updated = AuthManager.toggleOfficerStatus(id);
        this.renderAdminRoster();
        this.renderAdminAudit();
        this.showToast(`Officer ${id} status set to ${updated?.status || 'UPDATED'}`);
      });
    });

    // Login As
    listEl.querySelectorAll('.btn-quick-login-officer').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.officerId;
        const currentOfficers = AuthManager.getOfficersFromStorage();
        const officer = currentOfficers.find(o => o.id === id);
        if (officer) {
          if (officer.status !== 'ACTIVE') {
            this.showToast(`Cannot login: Officer ${id} is SUSPENDED.`);
            return;
          }
          this.applyOfficerSession(officer);
          this.showToast(`Switched to Officer ${officer.id}`);
          this.navigateTo('dashboard');
        }
      });
    });

    // Reset PIN Modal trigger
    listEl.querySelectorAll('.btn-open-reset-pin').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.officerId;
        const name = e.currentTarget.dataset.officerName;
        const modal = document.getElementById('modal-reset-pin');
        document.getElementById('reset-modal-officer-name').textContent = name || id;
        document.getElementById('reset-modal-officer-id').textContent = id;
        document.getElementById('reset-modal-target-id').value = id;
        const pinInput = document.getElementById('reset-modal-new-pin');
        if (pinInput) pinInput.value = '';
        const feedback = document.getElementById('reset-modal-feedback');
        if (feedback) feedback.className = 'hidden';
        modal?.classList.remove('hidden');
        pinInput?.focus();
      });
    });

    // Edit Officer Modal trigger
    listEl.querySelectorAll('.btn-open-edit-officer').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.officerId;
        const currentOfficers = AuthManager.getOfficersFromStorage();
        const officer = currentOfficers.find(o => o.id === id);
        if (!officer) return;

        document.getElementById('edit-modal-target-id').value = officer.id;
        document.getElementById('edit-modal-name').value = officer.fullName || '';
        document.getElementById('edit-modal-rank').value = officer.rank || 'Sub-Inspector / Screener';
        document.getElementById('edit-modal-checkpoint').value = officer.checkpointId || 'CP-04-NORTH';
        document.getElementById('edit-modal-badge').value = officer.badgeNumber || '';

        document.getElementById('modal-edit-officer')?.classList.remove('hidden');
      });
    });

    // Decommission Officer
    listEl.querySelectorAll('.btn-delete-officer').forEach(btn => {
      btn.addEventListener('click', (e) => {
        const id = e.currentTarget.dataset.officerId;
        if (confirm(`Are you sure you want to DECOMMISSION officer ${id}? This will permanently remove access credentials.`)) {
          try {
            AuthManager.deleteOfficer(id);
            this.renderAdminRoster();
            this.renderAdminAudit();
            this.showToast(`Officer ${id} decommissioned.`);
          } catch (err) {
            alert(err.message);
          }
        }
      });
    });
  }

  renderAdminPolicies() {
    const config = AuthManager.getSectorConfig();

    // Threat level choice buttons
    document.querySelectorAll('.btn-threat-choice').forEach(btn => {
      const threat = btn.dataset.threat;
      const isSelected = config.threatLevel === threat;
      const icon = btn.querySelector('.material-symbols-outlined');
      if (isSelected) {
        if (threat === 'ALPHA') {
          btn.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-secondary/15 border-secondary text-secondary';
        } else if (threat === 'BRAVO') {
          btn.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-tertiary/15 border-tertiary text-tertiary';
        } else {
          btn.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-error-container/30 border-error text-error';
        }
        if (icon) {
          icon.textContent = 'check_circle';
          icon.className = 'material-symbols-outlined text-[20px]';
        }
      } else {
        btn.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-surface-container-highest/50 border-outline/20 hover:border-outline/40 text-on-surface';
        if (icon) {
          icon.textContent = 'radio_button_unchecked';
          icon.className = 'material-symbols-outlined text-[20px] text-outline';
        }
      }
    });

    // Checkboxes
    const dualBio = document.getElementById('policy-dual-biometrics');
    if (dualBio) dualBio.checked = !!config.dualBiometrics;

    const strictUv = document.getElementById('policy-strict-uv');
    if (strictUv) strictUv.checked = config.strictUv !== false;

    const interpol = document.getElementById('policy-interpol-flag');
    if (interpol) interpol.checked = config.autoFlagInterpol !== false;

    const lockdown = document.getElementById('policy-lockdown-mode');
    if (lockdown) lockdown.checked = !!config.lockdownMode;

    const alertMsg = document.getElementById('policy-alert-message');
    if (alertMsg) alertMsg.value = config.alertMessage || 'Normal border screening operations in effect.';
  }

  renderAdminAudit() {
    const listEl = document.getElementById('admin-audit-entries-list');
    if (!listEl) return;

    const logs = AuthManager.getAdminAuditLogs();

    if (logs.length === 0) {
      listEl.innerHTML = '<div class="p-6 text-center font-mono text-xs text-outline">Audit trail is currently empty.</div>';
      return;
    }

    listEl.innerHTML = logs.map(l => {
      const timeStr = new Date(l.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      const dateStr = new Date(l.timestamp).toLocaleDateString([], { day: '2-digit', month: 'short' });

      let actionBadge = 'bg-primary/20 text-primary border-primary/30';
      if (l.action === 'STATUS_CHANGE' || l.action === 'DECOMMISSION_OFFICER') {
        actionBadge = 'bg-error-container/30 text-error border-error/30';
      } else if (l.action === 'CONFIG_UPDATE') {
        actionBadge = 'bg-tertiary/20 text-tertiary border-tertiary/30';
      } else if (l.action === 'ENROLL_OFFICER') {
        actionBadge = 'bg-secondary/20 text-secondary border-secondary/30';
      }

      return `
        <div class="p-3 rounded-xl bg-surface-container-highest/50 border border-outline/15 flex flex-col sm:flex-row sm:items-center justify-between gap-2 hover:border-outline/30 transition-all">
          <div class="flex items-start sm:items-center gap-2.5">
            <span class="px-2 py-0.5 rounded text-[9px] font-bold border uppercase tracking-wider ${actionBadge}">
              ${l.action}
            </span>
            <div class="flex flex-col">
              <span class="text-on-surface font-semibold text-[11px]">${l.details}</span>
              <span class="text-outline text-[10px]">Target: <code class="text-primary">${l.target || 'SYSTEM'}</code> · By: ${l.adminName || 'Admin'} (${l.adminId})</span>
            </div>
          </div>
          <div class="text-right text-[10px] text-outline flex-shrink-0">
            <span>${dateStr} ${timeStr}</span>
            <div class="text-[8px] text-outline/60">${l.id}</div>
          </div>
        </div>
      `;
    }).join('');
  }

  updateSyncUI() {
    const isOnline = syncInstance.isOnline();
    const isSyncing = syncInstance.isSyncing;

    const badges = document.querySelectorAll('.sync-state-badge');
    badges.forEach(badge => {
      if (isSyncing) {
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-primary animate-ping"></span><span class="font-label-data text-code-sm text-primary uppercase">SYNCING LEDGER...</span>';
      } else if (isOnline) {
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-secondary"></span><span class="font-label-data text-code-sm text-secondary uppercase">STORE & FORWARD // ONLINE</span>';
      } else {
        badge.innerHTML = '<span class="w-1.5 h-1.5 rounded-full bg-tertiary animate-pulse"></span><span class="font-label-data text-code-sm text-tertiary uppercase">OFFLINE // LOCAL QUEUE ACTIVE</span>';
      }
    });
  }

  showToast(message) {
    const toast = document.getElementById('app-toast');
    if (!toast) return;
    toast.textContent = message;
    toast.classList.remove('opacity-0', 'translate-y-4', 'pointer-events-none');
    setTimeout(() => {
      toast.classList.add('opacity-0', 'translate-y-4', 'pointer-events-none');
    }, 3200);
  }

  bindEvents() {
    // Navigation items
    document.querySelectorAll('.nav-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.navigateTo(btn.dataset.screen);
      });
    });

    // Hardware & Storage Persistence verification button (Step 0c)
    document.getElementById('btn-request-hardware-perm')?.addEventListener('click', async () => {
      this.showToast('Verifying Camera & Storage Permissions...');
      const res = await this.requestFirstUsePermissions(true);
      if (res.cameraGranted) {
        this.showToast('✅ Camera & Storage Permissions Active & Persisted');
      } else {
        this.showToast('⚠️ Camera permission prompt requires user approval');
      }
    });

    // --- AUTHENTICATION MODE SWITCHER ---
    const tabOfficer = document.getElementById('tab-btn-officer');
    const tabAdmin = document.getElementById('tab-btn-admin');

    tabOfficer?.addEventListener('click', () => this.switchLoginTab('officer'));
    tabAdmin?.addEventListener('click', () => this.switchLoginTab('admin'));

    // --- PASSWORD VISIBILITY TOGGLE ---
    const togglePwBtn = document.getElementById('toggle-officer-pw-btn');
    const pwInput = document.getElementById('login-officer-password');
    const pwIcon = document.getElementById('officer-pw-icon');
    togglePwBtn?.addEventListener('click', () => {
      if (pwInput.type === 'password') {
        pwInput.type = 'text';
        if (pwIcon) pwIcon.textContent = 'visibility_off';
      } else {
        pwInput.type = 'password';
        if (pwIcon) pwIcon.textContent = 'visibility';
      }
    });

    // --- BORDER OFFICER LOGIN (NO SIGNUP - ANTI-FRAUD) ---
    const officerForm = document.getElementById('officer-login-form');
    const officerError = document.getElementById('officer-login-error');
    const officerErrorText = document.getElementById('officer-login-error-text');
    const officerLoginBtn = document.getElementById('btn-officer-login');

    officerForm?.addEventListener('submit', (e) => this.submitOfficerLogin(e));
    officerLoginBtn?.addEventListener('click', (e) => this.submitOfficerLogin(e));

    // --- ONE-CLICK DEMO ACCESS BUTTON ---
    const demoBtn = document.getElementById('btn-quick-demo');
    demoBtn?.addEventListener('click', () => this.launchDemoMode());

    // --- SECTOR COMMAND ADMIN LOGIN ---
    const adminForm = document.getElementById('admin-login-form');
    const adminLoginBtn = document.getElementById('btn-admin-login');
    adminForm?.addEventListener('submit', (e) => this.submitAdminLogin(e));
    adminLoginBtn?.addEventListener('click', (e) => this.submitAdminLogin(e));

    // --- ADMIN TO TERMINAL NAVIGATION ---
    document.getElementById('admin-to-terminal-btn')?.addEventListener('click', () => this.navigateTo('dashboard'));

    // --- ADMIN CONSOLE LOGOUT & ADD OFFICER ---
    const adminLogoutBtn = document.getElementById('admin-logout-btn');
    adminLogoutBtn?.addEventListener('click', () => {
      AuthManager.logout();
      this.showToast('Exited Sector Admin Console');
      this.navigateTo('login');
    });

    const addOfficerForm = document.getElementById('admin-add-officer-form');
    const feedbackEl = document.getElementById('new-officer-feedback');
    const addOfficerBtn = document.getElementById('btn-submit-new-officer');

    addOfficerForm?.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (feedbackEl) feedbackEl.className = 'hidden';

      const name = document.getElementById('new-officer-name')?.value.trim();
      const id = document.getElementById('new-officer-id')?.value.trim();
      const rank = document.getElementById('new-officer-rank')?.value;
      const cpSelect = document.getElementById('new-officer-checkpoint');
      const checkpointId = cpSelect?.value;
      const checkpointName = cpSelect?.options[cpSelect.selectedIndex]?.text;
      const badgeNumber = document.getElementById('new-officer-badge')?.value.trim();
      const pin = document.getElementById('new-officer-pin')?.value;

      try {
        if (addOfficerBtn) {
          addOfficerBtn.disabled = true;
          addOfficerBtn.innerHTML = '<span class="material-symbols-outlined text-[18px] animate-spin">progress_activity</span><span>Enrolling...</span>';
        }

        const created = await AuthManager.adminAddOfficer({
          id,
          fullName: name,
          rank,
          checkpointId,
          checkpointName,
          badgeNumber,
          password: pin
        });

        if (feedbackEl) {
          feedbackEl.className = 'p-3 rounded-xl bg-secondary/20 border border-secondary/50 text-secondary font-mono text-xs flex items-center gap-2';
          feedbackEl.innerHTML = `<span class="material-symbols-outlined text-[18px]">verified</span><span>Officer <strong>${created.id}</strong> (${created.fullName}) enrolled successfully! Credentials ready for immediate checkpoint login.</span>`;
        }

        addOfficerForm.reset();
        this.renderAdminRoster();
        this.showToast(`✅ Enrolled ${created.id}`);
      } catch (err) {
        if (feedbackEl) {
          feedbackEl.className = 'p-3 rounded-xl bg-error-container/30 border border-error/50 text-error font-mono text-xs flex items-center gap-2';
          feedbackEl.innerHTML = `<span class="material-symbols-outlined text-[18px]">error</span><span>${err.message}</span>`;
        }
      } finally {
        if (addOfficerBtn) {
          addOfficerBtn.disabled = false;
          addOfficerBtn.innerHTML = '<span class="material-symbols-outlined text-[18px]">verified</span><span>Enroll Officer into Database</span>';
        }
      }
    });

    // --- ADMIN NAVIGATION, SUB-TABS & DIRECTIVES ---
    const adminToTerminalBtn = document.getElementById('admin-to-terminal-btn');
    adminToTerminalBtn?.addEventListener('click', () => {
      this.navigateTo('dashboard');
    });

    // Sub-Tabs
    const tabRosterBtn = document.getElementById('btn-admin-tab-roster');
    const tabPoliciesBtn = document.getElementById('btn-admin-tab-policies');
    const tabAuditBtn = document.getElementById('btn-admin-tab-audit');

    const secRoster = document.getElementById('admin-section-roster');
    const secPolicies = document.getElementById('admin-section-policies');
    const secAudit = document.getElementById('admin-section-audit');

    const setAdminSubTab = (activeTab) => {
      const activeClass = 'py-2.5 rounded-lg bg-surface-container text-tertiary font-bold uppercase transition-all flex items-center justify-center gap-1.5 shadow-sm';
      const inactiveClass = 'py-2.5 rounded-lg text-on-surface-variant hover:text-on-surface font-semibold uppercase transition-all flex items-center justify-center gap-1.5';

      if (tabRosterBtn) tabRosterBtn.className = activeTab === 'roster' ? activeClass : inactiveClass;
      if (tabPoliciesBtn) tabPoliciesBtn.className = activeTab === 'policies' ? activeClass : inactiveClass;
      if (tabAuditBtn) tabAuditBtn.className = activeTab === 'audit' ? activeClass : inactiveClass;

      secRoster?.classList.toggle('hidden', activeTab !== 'roster');
      secPolicies?.classList.toggle('hidden', activeTab !== 'policies');
      secAudit?.classList.toggle('hidden', activeTab !== 'audit');

      if (activeTab === 'roster') this.renderAdminRoster();
      if (activeTab === 'policies') this.renderAdminPolicies();
      if (activeTab === 'audit') this.renderAdminAudit();
    };

    tabRosterBtn?.addEventListener('click', () => setAdminSubTab('roster'));
    tabPoliciesBtn?.addEventListener('click', () => setAdminSubTab('policies'));
    tabAuditBtn?.addEventListener('click', () => setAdminSubTab('audit'));

    // Search & Filter
    const adminSearchInput = document.getElementById('admin-search-input');
    adminSearchInput?.addEventListener('input', () => this.renderAdminRoster());

    const adminFilterStatus = document.getElementById('admin-filter-status');
    adminFilterStatus?.addEventListener('change', () => this.renderAdminRoster());

    // Export Buttons
    document.getElementById('btn-export-json')?.addEventListener('click', () => {
      AuthManager.exportOfficersJSON();
      this.showToast('📁 Exported Officers Directory (JSON)');
    });

    document.getElementById('btn-export-csv')?.addEventListener('click', () => {
      AuthManager.exportOfficersCSV();
      this.showToast('📊 Exported Officers Directory (CSV)');
    });

    // Threat Choice Selector
    let chosenThreat = 'ALPHA';
    document.querySelectorAll('.btn-threat-choice').forEach(btn => {
      btn.addEventListener('click', (e) => {
        chosenThreat = e.currentTarget.dataset.threat;
        document.querySelectorAll('.btn-threat-choice').forEach(b => {
          const isSelected = b.dataset.threat === chosenThreat;
          const icon = b.querySelector('.material-symbols-outlined');
          if (isSelected) {
            if (chosenThreat === 'ALPHA') b.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-secondary/15 border-secondary text-secondary';
            if (chosenThreat === 'BRAVO') b.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-tertiary/15 border-tertiary text-tertiary';
            if (chosenThreat === 'CHARLIE') b.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-error-container/30 border-error text-error';
            if (icon) { icon.textContent = 'check_circle'; icon.className = 'material-symbols-outlined text-[20px]'; }
          } else {
            b.className = 'btn-threat-choice p-4 rounded-xl border text-left flex flex-col gap-1.5 transition-all bg-surface-container-highest/50 border-outline/20 hover:border-outline/40 text-on-surface';
            if (icon) { icon.textContent = 'radio_button_unchecked'; icon.className = 'material-symbols-outlined text-[20px] text-outline'; }
          }
        });
      });
    });

    // Save Policies
    const btnSavePolicies = document.getElementById('btn-save-policies');
    btnSavePolicies?.addEventListener('click', () => {
      const dualBiometrics = document.getElementById('policy-dual-biometrics')?.checked;
      const strictUv = document.getElementById('policy-strict-uv')?.checked;
      const autoFlagInterpol = document.getElementById('policy-interpol-flag')?.checked;
      const lockdownMode = document.getElementById('policy-lockdown-mode')?.checked;
      const alertMessage = document.getElementById('policy-alert-message')?.value;

      AuthManager.updateSectorConfig({
        threatLevel: chosenThreat,
        dualBiometrics,
        strictUv,
        autoFlagInterpol,
        lockdownMode,
        alertMessage
      });

      const savedToast = document.getElementById('policies-saved-toast');
      if (savedToast) {
        savedToast.classList.remove('hidden');
        setTimeout(() => savedToast.classList.add('hidden'), 3500);
      }

      this.showToast(`🛡️ Threat Level ${chosenThreat} applied across sector!`);
      this.renderAdminRoster();
      this.renderAdminAudit();
    });

    // Refresh Audit Log
    document.getElementById('btn-refresh-audit')?.addEventListener('click', () => {
      this.renderAdminAudit();
      this.showToast('Audit journal refreshed');
    });

    // Reset PIN Form & Modal
    const modalResetPin = document.getElementById('modal-reset-pin');
    const formResetPin = document.getElementById('form-reset-pin');
    const closeResetModal = () => modalResetPin?.classList.add('hidden');

    document.getElementById('btn-close-reset-modal')?.addEventListener('click', closeResetModal);
    document.getElementById('btn-cancel-reset')?.addEventListener('click', closeResetModal);

    formResetPin?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const targetId = document.getElementById('reset-modal-target-id')?.value;
      const newPin = document.getElementById('reset-modal-new-pin')?.value;
      const feedback = document.getElementById('reset-modal-feedback');

      try {
        await AuthManager.resetOfficerPin(targetId, newPin);
        if (feedback) {
          feedback.className = 'p-2.5 rounded-xl bg-secondary/20 text-secondary font-mono text-xs flex items-center gap-1.5';
          feedback.innerHTML = `<span class="material-symbols-outlined text-[16px]">check</span><span>PIN updated successfully for ${targetId}!</span>`;
        }
        setTimeout(() => {
          closeResetModal();
          this.renderAdminRoster();
          this.renderAdminAudit();
          this.showToast(`🔑 PIN reset complete for ${targetId}`);
        }, 1200);
      } catch (err) {
        if (feedback) {
          feedback.className = 'p-2.5 rounded-xl bg-error-container/30 text-error font-mono text-xs';
          feedback.textContent = err.message;
        }
      }
    });

    // Edit Officer Form & Modal
    const modalEditOfficer = document.getElementById('modal-edit-officer');
    const formEditOfficer = document.getElementById('form-edit-officer');
    const closeEditModal = () => modalEditOfficer?.classList.add('hidden');

    document.getElementById('btn-close-edit-modal')?.addEventListener('click', closeEditModal);
    document.getElementById('btn-cancel-edit')?.addEventListener('click', closeEditModal);

    formEditOfficer?.addEventListener('submit', (e) => {
      e.preventDefault();
      const targetId = document.getElementById('edit-modal-target-id')?.value;
      const fullName = document.getElementById('edit-modal-name')?.value;
      const rank = document.getElementById('edit-modal-rank')?.value;
      const cpSelect = document.getElementById('edit-modal-checkpoint');
      const checkpointId = cpSelect?.value;
      const checkpointName = cpSelect?.options[cpSelect.selectedIndex]?.text;
      const badgeNumber = document.getElementById('edit-modal-badge')?.value;

      try {
        AuthManager.updateOfficer(targetId, {
          fullName,
          rank,
          checkpointId,
          checkpointName,
          badgeNumber
        });

        closeEditModal();
        this.renderAdminRoster();
        this.renderAdminAudit();
        this.showToast(`Updated details for Officer ${targetId}`);
      } catch (err) {
        alert(err.message);
      }
    });

    // Dashboard quick triggers
    const dashScanBtn = document.getElementById('dash-scan-btn');
    if (dashScanBtn) {
      dashScanBtn.addEventListener('click', () => this.navigateTo('capture'));
    }

    // Capture screen triggers
    const docTypeSelect = document.getElementById('capture-doc-type-select');
    if (docTypeSelect) {
      docTypeSelect.addEventListener('change', (e) => {
        this.selectedDocType = e.target.value;
        this.updateViewfinderForDocType(this.selectedDocType);
        this.showToast(`📋 Document Type Set: ${this.selectedDocType.toUpperCase()}`);
        console.log(`[Officer Selection] Document type selected at capture time: ${this.selectedDocType}`);
      });
    }

    const shutterBtn = document.getElementById('shutter-btn');
    if (shutterBtn) {
      shutterBtn.addEventListener('click', () => this.triggerCapture());
    }

    const retakeModalClose = document.getElementById('retake-modal-close');
    if (retakeModalClose) {
      retakeModalClose.addEventListener('click', () => this.hideRetakeModal());
    }

    const switchCamBtn = document.getElementById('cam-switch-btn');
    if (switchCamBtn) {
      switchCamBtn.addEventListener('click', () => {
        this.stopCamera();
        this.startCamera();
      });
    }

    // Document image file upload (desktop/laptop testing)
    const docFileInput = document.getElementById('document-file-input');
    if (docFileInput) {
      docFileInput.addEventListener('change', (e) => {
        if (e.target.files && e.target.files[0]) {
          this.handleImageUpload(e.target.files[0]);
        }
      });
    }

    // Step 3: OCR Test Action Buttons & Modal
    const btnOcrTest = document.getElementById('btn-ocr-test-action');
    if (btnOcrTest) {
      btnOcrTest.addEventListener('click', () => this.handleRunOCRTest());
    }

    const btnDiagOcr = document.getElementById('btn-test-sample-ocr');
    if (btnDiagOcr) {
      btnDiagOcr.addEventListener('click', () => this.handleRunOCRTest());
    }

    const ocrModalClose = document.getElementById('ocr-result-modal-close');
    if (ocrModalClose) {
      ocrModalClose.addEventListener('click', () => this.hideOCRModal());
    }

    // Step 4: Structured OCR Field Inspection Buttons & Modal
    const btnInspectFields = document.getElementById('btn-inspect-fields-action');
    if (btnInspectFields) {
      btnInspectFields.addEventListener('click', () => this.handleInspectExtractedFields());
    }

    document.querySelectorAll('.btn-open-fields-modal').forEach(btn => {
      btn.addEventListener('click', () => this.openExtractedFieldsModal());
    });

    const fieldsModalClose = document.getElementById('extracted-fields-modal-close');
    if (fieldsModalClose) {
      fieldsModalClose.addEventListener('click', () => this.closeExtractedFieldsModal());
    }

    const fieldsModalCloseBottom = document.getElementById('modal-close-bottom-btn');
    if (fieldsModalCloseBottom) {
      fieldsModalCloseBottom.addEventListener('click', () => this.closeExtractedFieldsModal());
    }

    const fieldsModal = document.getElementById('extracted-fields-inspection-modal');
    if (fieldsModal) {
      fieldsModal.addEventListener('click', (e) => {
        if (e.target === fieldsModal) this.closeExtractedFieldsModal();
      });
    }

    // Fast Lane actions
    const btnFastlaneAdmit = document.getElementById('btn-fastlane-admit');
    if (btnFastlaneAdmit) {
      btnFastlaneAdmit.addEventListener('click', () => this.admitFrequentCrosser());
    }

    const btnFastlaneTransfer = document.getElementById('btn-fastlane-transfer-full');
    if (btnFastlaneTransfer) {
      btnFastlaneTransfer.addEventListener('click', () => {
        this.navigateTo('processing');
        this.runPipelineStages(this.activeFastLaneDoc);
      });
    }

    // Result Approved actions
    const confirmAdmitBtn = document.getElementById('btn-confirm-admit');
    if (confirmAdmitBtn) {
      confirmAdmitBtn.addEventListener('click', () => this.confirmAdmitPassenger());
    }

    // Result Flagged actions
    const btnEscalate = document.getElementById('btn-escalate-secondary');
    if (btnEscalate) {
      btnEscalate.addEventListener('click', () => this.escalateToSecondary());
    }

    const btnOverride = document.getElementById('btn-officer-override');
    if (btnOverride) {
      btnOverride.addEventListener('click', () => this.overrideWithNotes());
    }

    // Audit verify trigger
    const btnVerifyLedger = document.getElementById('btn-verify-chain');
    if (btnVerifyLedger) {
      btnVerifyLedger.addEventListener('click', () => this.verifyLedgerIntegrity());
    }

    const verifyModalClose = document.getElementById('verify-modal-close');
    if (verifyModalClose) {
      verifyModalClose.addEventListener('click', () => {
        const modal = document.getElementById('verify-modal');
        if (modal) modal.classList.add('hidden');
      });
    }

    // Profile network toggle
    const netToggleBtn = document.getElementById('network-toggle-btn');
    if (netToggleBtn) {
      netToggleBtn.addEventListener('click', () => {
        syncInstance.setSimulatedOffline(!syncInstance.simulatedOffline);
        this.renderProfile();
      });
    }
  }
}

// Instantiate and attach to window
window.app = new DocuShieldApp();
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    window.app.init();
  });
} else {
  window.app.init();
}
