<div align="center">

# 🛡️ DocuShield

### AI-Powered Border Document Screening Console

**Offline-First • On-Device ML • Tamper-Proof Audit Logs**

[![SIH 2025](https://img.shields.io/badge/SIH_2025-Border_Security-blue?style=for-the-badge)](https://www.sih.gov.in/)
[![PWA Ready](https://img.shields.io/badge/PWA-Installable-72d9b7?style=for-the-badge&logo=pwa)](https://docushield.vercel.app/install.html)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)

[**🚀 Live Demo**](https://docushield.vercel.app) · [**📲 Install App**](https://docushield.vercel.app/install.html) · [**📋 Documentation**](#architecture)

</div>

---

## 🎯 Problem Statement

Border checkpoints in remote areas (Indo-Nepal, Indo-Bangladesh) face:
- **No reliable internet** — existing cloud-based verification fails
- **Untrained officers** manually checking 1000+ documents daily
- **Forged/tampered documents** slipping through visual inspection
- **Zero audit trail** — no tamper-proof record of screening decisions

## 💡 Solution

**DocuShield** is an **offline-first PWA** that performs AI-powered document verification **entirely on-device** using Edge ML inference — no internet required.

### Key Features

| Feature | Description |
|---|---|
| 🔍 **8-Stage AI Pipeline** | OCR → MRZ Validation → Cross-field Check → Tamper Detection → Biometric Match |
| 📴 **100% Offline** | Full ML inference runs on-device via Edge TPU / WebAssembly |
| 🔗 **SHA-256 Audit Chain** | Every scan produces an immutable, hash-linked cryptographic log |
| 📡 **Store & Forward** | Queues sync data and pushes when connectivity resumes |
| 🎯 **Never Auto-Rejects** | Flags anomalies for human review — officer always makes final call |
| 📱 **Installable PWA** | Install as native app on Android, iOS, or Desktop |
| 🖥️ **Fully Responsive** | Optimized for mobile phones, tablets, laptops, and desktops |

---

## 📲 Install the App

### Option 1: QR Code / Link
Visit the **[Install Page](https://docushield.vercel.app/install.html)** → scan the QR code or tap "Install".

### Option 2: Browser Install
1. Open **[docushield.vercel.app](https://docushield.vercel.app)** in Chrome/Edge
2. Click the **install icon** (⊕) in the address bar
3. Or on mobile: **Menu → Add to Home Screen**

### Option 3: Manual (Local)
```bash
git clone https://github.com/Jyotirmaya01/Docushield.git
cd Docushield
# Open index.html in a browser, or serve with:
npx serve .
```

---

## 🏗️ Architecture

```
Docushield/
├── index.html              # Main SPA shell (all screens)
├── install.html            # PWA install page with QR code
├── styles.css              # Responsive CSS (mobile → desktop)
├── manifest.json           # PWA manifest (icons, scope, display)
├── sw.js                   # Service Worker (offline caching)
├── vercel.json             # Vercel deployment config
│
├── src/
│   ├── app.js              # Main app controller & screen router
│   ├── config.js           # App configuration
│   ├── samples.js          # Demo specimen data
│   ├── cv/
│   │   └── qualityGate.js  # Camera quality gate (blur, glare, framing)
│   ├── pipeline/
│   │   ├── forensicEngine.js  # 8-stage forensic analysis pipeline
│   │   └── mrzValidator.js    # ICAO 9303 MRZ checksum validator
│   ├── ledger/
│   │   ├── hashChain.js    # SHA-256 immutable audit chain
│   │   └── syncManager.js  # Store & forward sync manager
│   └── api/
│       └── backendClient.js # Backend API client
│
├── backend/
│   ├── server.py           # Python Flask backend
│   ├── database.py         # Database operations
│   ├── db_schema.sql       # PostgreSQL schema
│   ├── db_schema_sqlite.sql # SQLite schema (offline)
│   ├── config.py           # Backend config
│   ├── setup_db.py         # Database setup script
│   └── requirements.txt    # Python dependencies
│
└── assets/
    ├── logo.svg            # DocuShield vector logo
    ├── icon-*.png           # PWA icons (72–512px)
    └── generate-icons.html  # Icon generation tool
```

---

## 🖥️ Responsive Design

| Viewport | Layout |
|---|---|
| **📱 Mobile** (< 640px) | Full-width single column, bottom navigation dock |
| **📱 Tablet** (640–1023px) | 720px centered column, bottom navigation |
| **💻 Laptop** (≥ 1024px) | Left sidebar navigation (220px) + wide content |
| **🖥️ Desktop** (≥ 1280px) | Sidebar + constrained content, multi-column grids |

---

## 🔒 Security & Privacy

- **Zero data leaves the device** during offline operation
- **SHA-256 hash chains** make audit logs cryptographically tamper-evident
- **No cloud dependency** — all ML inference runs locally
- **Officer authorization required** for all screening decisions
- **Store & Forward** encrypts queued data before transmission

---

## 🛠️ Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, Tailwind CSS, Vanilla JavaScript (ES Modules) |
| **PWA** | Service Worker, Web App Manifest, Cache API |
| **ML Inference** | On-device (WebAssembly / Edge TPU simulation) |
| **Cryptography** | Web Crypto API (SHA-256) |
| **Backend** | Python Flask, SQLite/PostgreSQL |
| **Deployment** | Vercel (static PWA), GitHub Pages (fallback) |

---

## 🤝 Contributing

We welcome contributions! See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

```bash
# Fork & clone the repo
git clone https://github.com/<your-username>/Docushield.git
cd Docushield

# Create a feature branch
git checkout -b feature/your-feature-name

# Make changes, then commit
git add .
git commit -m "feat: your feature description"

# Push and create a PR
git push origin feature/your-feature-name
```

---

## 📄 License

This project is licensed under the MIT License — see [LICENSE](LICENSE) for details.

---

## 👥 Team

**Team Border Intelligence** — SIH 2025

Built for SSB Border Command, Indo-Nepal Tactical Screening Operations.

---

<div align="center">

**⭐ Star this repo if you find DocuShield useful!**

</div>
