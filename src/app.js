/**
 * DocuShield Main Controller & Application Orchestrator
 * Interconnects all 8 Stitch screens, CV Quality Gate, Forensic Pipeline,
 * Cryptographic Ledger, and Store-and-Forward Sync.
 */

import { CONFIG } from './config.js';
import { SAMPLE_SPECIMENS } from './samples.js';
import { QualityGate } from './cv/qualityGate.js';
import { ForensicEngine } from './pipeline/forensicEngine.js';
import { ledgerInstance } from './ledger/hashChain.js';
import { syncInstance } from './ledger/syncManager.js';
import { BackendAPI } from './api/backendClient.js';
import { AuthManager } from './auth/authManager.js';

class DocuShieldApp {
  constructor() {
    this.currentScreen = 'login';
    this.activeSpecimen = SAMPLE_SPECIMENS[0];
    this.videoStream = null;
    this.cameraActive = false;
    this.analysisInterval = null;
    this.currentPipelineResult = null;
    this.currentScanId = null;         // UUID for current scan in SQLite
    this.lastCapturedCanvas = null;    // Canvas snapshot for JPEG storage
    this.backendAvailable = false;     // Track backend connectivity
    this.reviewQueue = [];
    this.selectedQueueItem = null;

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

  init() {
    this.bindEvents();
    this.updateSyncUI();
    syncInstance.subscribe(() => this.updateSyncUI());
    this.navigateTo('login');

    // Check backend availability on startup
    BackendAPI.isAvailable().then(available => {
      this.backendAvailable = available;
      console.log(`[DocuShield] Backend SQLite: ${available ? '✅ CONNECTED' : '⚠️ OFFLINE (local-only mode)'}`);
    });
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

    if (screenId === 'login') {
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

    if (glareVal) glareVal.textContent = `${quality.checks.glare.status} (${quality.overexposedPct}%)`;
    if (framingVal) framingVal.textContent = `${quality.checks.framing.status} (${quality.framingScore}%)`;
    if (blurVal) blurVal.textContent = `${quality.checks.blur.status} (VAR: ${quality.laplacianVariance})`;

    if (quality.passed) {
      if (hudBanner) hudBanner.className = 'w-full flex items-center justify-between px-space-md py-space-sm rounded-lg bg-surface-container-lowest border border-secondary/40 transition-colors duration-300';
      if (hudText) {
        hudText.textContent = 'DOCUMENT LOCKED — READY FOR SCAN';
        hudText.className = 'font-title-sm text-title-sm text-secondary uppercase tracking-wider';
      }
      if (hudDetail) hudDetail.textContent = 'OPTICAL & LIGHTING REQUIREMENTS SATISFIED';
      if (hudLockPct) hudLockPct.textContent = 'LOCK 100%';
      if (hudIcon) {
        hudIcon.textContent = 'verified';
        hudIcon.className = 'material-symbols-outlined text-[18px] text-secondary';
      }
      bracketMarks.forEach(bm => {
        bm.style.backgroundColor = '#72d9b7';
      });
    } else {
      if (hudBanner) hudBanner.className = 'w-full flex items-center justify-between px-space-md py-space-sm rounded-lg bg-surface-container-lowest border border-tertiary/40 transition-colors duration-300';
      if (hudText) {
        hudText.textContent = quality.retakePrompt || 'REALIGN DOCUMENT GUIDE';
        hudText.className = 'font-title-sm text-title-sm text-tertiary uppercase tracking-wider';
      }
      if (hudDetail) hudDetail.textContent = quality.guidanceAdvice || 'KEEP DOCUMENT STEADY & FLAT';
      if (hudLockPct) hudLockPct.textContent = 'ALIGNING...';
      if (hudIcon) {
        hudIcon.textContent = 'warning';
        hudIcon.className = 'material-symbols-outlined text-[18px] text-tertiary animate-pulse';
      }
      bracketMarks.forEach(bm => {
        bm.style.backgroundColor = '#ffb95a';
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
      <button type="button" data-id="${spec.id}" class="specimen-chip text-left p-2.5 rounded-lg border transition-all ${
        this.activeSpecimen.id === spec.id
          ? 'bg-surface-container-high border-primary text-on-surface shadow-sm'
          : 'bg-surface-container-lowest border-outline-variant/30 text-on-surface-variant hover:bg-surface-container'
      }">
        <div class="flex items-center justify-between mb-1">
          <span class="font-title-sm text-xs font-semibold uppercase text-on-surface truncate">${spec.title.split(':')[1] || spec.title}</span>
          <span class="font-label-micro text-[9px] px-1.5 py-0.5 rounded ${
            spec.badgeColor === 'secondary' ? 'bg-secondary-container/50 text-secondary' : 'bg-tertiary-container/50 text-tertiary'
          }">${spec.badge}</span>
        </div>
        <p class="font-body-sm text-[11px] text-on-surface-variant truncate">${spec.subtitle}</p>
      </button>
    `).join('');

    container.querySelectorAll('.specimen-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const found = SAMPLE_SPECIMENS.find(s => s.id === btn.dataset.id);
        if (found) {
          this.activeSpecimen = found;
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
        }
      });
    });
  }

  // --- EXECUTE FORENSIC PIPELINE & PROCESSING ---

  async triggerCapture() {
    let docDataToScreen = { ...this.activeSpecimen };

    if (this.cameraActive) {
      const canvas = document.getElementById('camera-canvas');
      const quality = QualityGate.analyzeImageQuality(canvas);
      if (!quality.passed) {
        this.showRetakeModal(quality);
        return;
      }
      docDataToScreen.qualityResult = quality;
    }

    this.navigateTo('processing');
    this.runPipelineStages(docDataToScreen);
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

      // ── SAVE TO SQLITE ──
      // Store the scan (with JPEG image) and analysis results in the database
      const canvas = document.getElementById('camera-canvas');
      this.lastCapturedCanvas = canvas;
      const scanResult = await BackendAPI.saveScan(documentData, canvas);
      if (scanResult && scanResult.scan_id) {
        this.currentScanId = scanResult.scan_id;
        // Save analysis results linked to this scan
        await BackendAPI.saveAnalysis(this.currentScanId, result, processingTimeMs);
        console.log(`[DB] ✅ Scan + Analysis stored in SQLite (${(processingTimeMs/1000).toFixed(2)}s pipeline)`);
      } else {
        this.currentScanId = 'local-' + Date.now();
        console.log('[DB] ⚠️ Backend unavailable — scan stored locally only');
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
        <div class="p-space-sm rounded-lg bg-surface-container border-l-4 border-tertiary flex flex-col gap-1">
          <div class="flex items-center justify-between">
            <span class="font-title-sm text-xs font-semibold text-tertiary uppercase tracking-wider">${a.module}</span>
            <span class="font-label-data text-code-sm text-tertiary font-bold">+${a.impact} RISK</span>
          </div>
          <p class="font-body-sm text-xs text-on-surface">${a.description}</p>
        </div>
      `).join('');
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
      <div class="p-space-sm rounded-xl bg-surface-container hover:bg-surface-container-high transition-colors flex flex-col gap-space-xs border border-surface-container-highest/60">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-space-sm">
            <img src="${item.photoUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=100'}" class="w-10 h-10 rounded-full object-cover border border-outline-variant/40" />
            <div class="flex flex-col">
              <span class="font-title-sm text-on-surface font-semibold">${item.travelerName}</span>
              <span class="font-label-data text-code-sm text-on-surface-variant">${item.docNumber} · ${item.nationality} · ${item.docType}</span>
            </div>
          </div>
          <div class="flex flex-col items-end gap-1">
            <span class="px-2 py-0.5 rounded font-label-data text-code-sm font-bold ${
              item.riskScore > 50 ? 'bg-error-container text-error' : 'bg-tertiary-container text-on-tertiary'
            }">RISK ${item.riskScore}</span>
            <span class="font-label-micro text-[9px] uppercase px-1.5 py-0.5 rounded ${
              item.syncStatus === 'SYNCED' ? 'bg-secondary/10 text-secondary' : 'bg-tertiary/10 text-tertiary'
            }">${item.syncStatus}</span>
          </div>
        </div>
        <div class="bg-surface-container-lowest/80 p-2 rounded text-xs text-on-surface-variant space-y-1">
          ${item.anomalies.map(anom => `<div class="flex items-start gap-1"><span class="text-tertiary">•</span><span>${anom}</span></div>`).join('')}
        </div>
        <div class="flex items-center justify-between pt-1 text-xs">
          <span class="text-outline font-label-data">${new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <div class="flex gap-2">
            ${item.status === 'PENDING' ? `
              <button data-idx="${idx}" class="queue-adjudicate-btn px-3 py-1 rounded bg-secondary text-on-secondary font-title-sm text-xs font-semibold uppercase hover:bg-secondary/90 transition-all">
                CLEAR / ADMIT
              </button>
            ` : `
              <span class="font-label-micro text-secondary uppercase font-semibold">ADJUDICATED</span>
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

    listEl.innerHTML = blocks.map(b => `
      <div class="p-space-base rounded-xl bg-surface-container border border-surface-container-highest flex flex-col gap-space-xs font-label-data">
        <div class="flex items-center justify-between pb-1 border-b border-surface-container-highest/60">
          <div class="flex items-center gap-space-xs">
            <span class="text-primary font-bold">BLOCK #${b.index}</span>
            <span class="text-outline font-normal">·</span>
            <span class="text-on-surface font-semibold text-xs">${b.travelerName}</span>
          </div>
          <span class="px-2 py-0.5 rounded text-code-sm font-semibold uppercase ${
            b.syncStatus === 'SYNCED' ? 'bg-secondary/15 text-secondary' : 'bg-tertiary/15 text-tertiary animate-pulse'
          }">${b.syncStatus}</span>
        </div>
        <div class="grid grid-cols-2 gap-2 text-xs py-1">
          <div>
            <span class="text-outline text-[10px] uppercase block">DOC ID / REF</span>
            <span class="text-on-surface font-medium">${b.docId} (${b.nationality})</span>
          </div>
          <div>
            <span class="text-outline text-[10px] uppercase block">DECISION</span>
            <span class="font-bold ${
              b.decision === 'AUTO_APPROVED' ? 'text-secondary' : (b.decision === 'OFFICER_OVERRIDE' ? 'text-primary' : 'text-tertiary')
            }">${b.decision}</span>
          </div>
          <div>
            <span class="text-outline text-[10px] uppercase block">OFFICER ID</span>
            <span class="text-on-surface">${b.officerId}</span>
          </div>
          <div>
            <span class="text-outline text-[10px] uppercase block">TIMESTAMP (UTC)</span>
            <span class="text-on-surface">${new Date(b.timestamp).toISOString().replace('T', ' ').substring(0, 19)}</span>
          </div>
        </div>
        <div class="bg-surface-container-lowest p-2 rounded flex flex-col gap-1 text-[11px] font-mono break-all text-outline">
          <div class="flex items-center justify-between text-on-surface-variant">
            <span>HASH:</span>
            <span class="text-primary-fixed">${b.hash.substring(0, 20)}...${b.hash.substring(44)}</span>
          </div>
          <div class="flex items-center justify-between text-[10px]">
            <span>PREV:</span>
            <span class="text-outline">${b.prevHash.substring(0, 18)}...</span>
          </div>
        </div>
      </div>
    `).join('');
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

    // Login screen trigger
    const loginForm = document.getElementById('login-form');
    if (loginForm) {
      loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        this.navigateTo('dashboard');
      });
    }

    // Dashboard quick triggers
    const dashScanBtn = document.getElementById('dash-scan-btn');
    if (dashScanBtn) {
      dashScanBtn.addEventListener('click', () => this.navigateTo('capture'));
    }

    // Capture screen triggers
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
document.addEventListener('DOMContentLoaded', () => {
  window.app.init();
});
