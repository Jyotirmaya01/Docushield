# Contributing to DocuShield

Thank you for your interest in contributing to DocuShield! This document provides guidelines for contributing to the project.

## 🚀 Getting Started

1. **Fork** the repository on GitHub
2. **Clone** your fork locally:
   ```bash
   git clone https://github.com/<your-username>/Docushield.git
   cd Docushield
   ```
3. **Create a branch** for your feature/fix:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## 📁 Project Structure

- `index.html` — Main SPA shell (all UI screens)
- `styles.css` — Responsive CSS styles
- `src/` — JavaScript modules (app logic, CV, pipeline, ledger)
- `backend/` — Python Flask backend
- `assets/` — Icons, logos, and static assets

## 🎨 Code Style

- **HTML/CSS**: Use Tailwind CSS utility classes. Follow the existing dark theme palette.
- **JavaScript**: ES Modules, `const`/`let` (no `var`), async/await for promises.
- **Python**: Follow PEP 8. Use type hints where possible.

## 📝 Commit Messages

Follow [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add biometric verification module
fix: correct MRZ checksum for TD2 format
docs: update install instructions
style: improve dashboard mobile layout
refactor: extract hash chain into separate module
```

## 🔍 Pull Request Process

1. Ensure your code works offline (this is an offline-first app)
2. Test on at least 2 viewport sizes (mobile + desktop)
3. Update documentation if you change the API
4. Describe your changes clearly in the PR description
5. Reference any related issues

## 🐛 Bug Reports

Open an issue with:
- Steps to reproduce
- Expected vs actual behavior
- Browser/device information
- Screenshots if applicable

## 📋 Feature Requests

Open an issue with the `enhancement` label describing:
- The problem you're solving
- Your proposed solution
- Any alternatives considered

## ⚖️ License

By contributing, you agree that your contributions will be licensed under the MIT License.
