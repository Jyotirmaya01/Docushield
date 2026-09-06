# 🤝 DocuShield - Team Collaboration & Contribution Guide

Welcome to the **DocuShield** collaborative repository! This project is maintained and led by **[@Jyotirmaya01](https://github.com/Jyotirmaya01)**.

To maintain code quality, security, and stability, **direct commits and pushes to the `main` branch are strictly prohibited**. Every single contribution, modification, and bug fix must go through a formal **Pull Request (PR)** and receive explicit line-by-line review and approval from **@Jyotirmaya01**.

---

## 🔒 The Golden Rules of Collaboration

1. **Never Push Directly to `main`**: All work must be completed on an isolated feature branch.
2. **Mandatory Code Review**: Every line of code will be reviewed by `@Jyotirmaya01` before merging.
3. **Offline-First & Mobile Responsive**: Any new UI or feature must work offline and look crisp across both mobile and desktop screens.
4. **Preserve Anti-Fraud Architecture**: Do not expose public officer signup or bypass authentication rules.

---

## 🛠️ Step-by-Step Collaborator Workflow

### Step 1: Getting Collaborator Access
1. Send your GitHub username to **@Jyotirmaya01**.
2. Wait for an invitation email or notification from GitHub to join the `Jyotirmaya01/Docushield` repository.
3. Accept the repository collaboration invitation.

### Step 2: Clone the Repository
Clone the repository to your local machine:
```bash
git clone https://github.com/Jyotirmaya01/Docushield.git
cd Docushield
```

### Step 3: Create a Feature Branch
Always branch off the latest `main`. Use a clear naming convention:
`feature/<your-name>-<brief-description>` or `fix/<your-name>-<issue>`

```bash
git checkout main
git pull origin main
git checkout -b feature/rahul-uv-scanner
```

### Step 4: Run Locally for Development
Run the local lightweight web server:
```bash
python -m http.server 8080
```
Open your browser at `http://localhost:8080` (or `http://<your-lan-ip>:8080` on mobile).

Optional (if testing the Python backend API):
```bash
pip install -r backend/requirements.txt
python backend/server.py
```

### Step 5: Test Your Changes Thoroughly
Before committing:
- Check mobile and desktop viewports (`Ctrl+Shift+M` in Chrome DevTools).
- Open DevTools Console (`F12`) to verify there are **zero errors or warnings**.
- Verify that existing features (Demo Mode, Officer Login, Admin Console) still work smoothly.

### Step 6: Commit and Push to Your Branch
Commit with clean, conventional commit messages:
```bash
git add .
git commit -m "feat(scanner): enhance UV light edge detection threshold"
git push -u origin feature/rahul-uv-scanner
```

### Step 7: Open a Pull Request (PR)
1. Go to [https://github.com/Jyotirmaya01/Docushield](https://github.com/Jyotirmaya01/Docushield).
2. GitHub will show a button: **"Compare & pull request"**. Click it.
3. Fill out the **Pull Request Template**:
   - Describe what you changed and why.
   - List the modified files and functions line by line.
   - Attach a screenshot or short clip proving it works.
   - Tag **@Jyotirmaya01** as the Reviewer.
4. Click **"Create pull request"**.

### Step 8: Code Review & Merging
- The automated GitHub Action (`Collaborator PR Sanity Check`) will run syntax and build checks.
- **@Jyotirmaya01** will review every line of code in the PR diff.
- If changes or corrections are requested, push additional commits to your feature branch; the PR will update automatically.
- Once approved, **@Jyotirmaya01** will merge your PR into `main`!

---

## 📁 Repository Structure Reference

```text
Docushield/
├── .github/
│   ├── CODEOWNERS                  # Sets @Jyotirmaya01 as mandatory reviewer
│   ├── pull_request_template.md    # Template for PR descriptions
│   ├── workflows/
│   │   └── collaborator-ci.yml    # Automated CI syntax validation
│   └── ISSUE_TEMPLATE/
│       └── collaborator_task.yml   # Feature proposal form
├── assets/                         # Icons, logos, and mock specimens
├── backend/                        # SQLite & FastAPI backend
│   ├── database.py                 # SQLite schema & auth queries
│   └── server.py                   # API routes
├── src/
│   ├── app.js                      # Core SPA router & biometric simulator
│   └── auth/
│       └── authManager.js          # Cryptographic auth & admin engine
├── index.html                      # Main tactical UI interface
├── install.html                    # Mobile PWA installer & scanner guide
├── styles.css                      # Tactical HUD & responsive stylesheets
├── sw.js                           # Offline Service Worker (v3)
└── manifest.json                   # PWA manifest
```

---

## ⚖️ Standards Checklist

Before asking for review:
- [ ] Code is formatted cleanly without leftover `console.log` debug spam.
- [ ] No hardcoded personal API keys or credentials.
- [ ] Responsive on 360px (mobile), 768px (tablet), and 1440px (desktop).
- [ ] Offline operation works without crashing.

Thank you for contributing to DocuShield! 🛡️
