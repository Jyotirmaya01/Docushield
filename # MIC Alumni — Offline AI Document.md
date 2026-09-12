# MIC Alumni — Offline AI Document Screening System

## 1. Product decision

Build an **offline-first installed desktop/tablet application with a web-based UI**.

It should run locally on the checkpoint device and open in a browser window or installed desktop shell. This gives you:

- A professional dashboard and scanning workflow.
- Local OCR, MRZ validation, AI analysis, and face verification.
- Operation without internet.
- Easier development through Antigravity.
- Future support for scanner cameras and forensic devices.

Do **not** begin with a public cloud website or a mobile-only app. The prototype should be a local officer workstation application.

Use this project name:

> **MIC Alumni — Secure Offline Identity and Document Screening System**

Use the following scope:

> The prototype assists authorized border checkpoint officers by screening passports, visas, national identity cards, permits, and related documents. It extracts information, validates document rules, detects visible tampering indicators, compares the document photograph with a live person capture, calculates an explainable risk score, and records a tamper-evident audit entry. The system supports offline operation and escalates uncertain cases to human review.

---

# 2. Important product rules

Antigravity must follow these rules throughout development:

1. The system is an **officer-assistance tool**, not an autonomous legal authority.
2. The system must never automatically reject a person solely because one AI check fails.
3. Failed, uncertain, blurry, incomplete, or conflicting checks must go to **manual review**.
4. Clean, high-confidence cases may be marked **Recommended: Clear**, but the officer makes the final decision.
5. Raw identity documents and biometric images must not be stored on the blockchain.
6. The blockchain or hash ledger stores only a tamper-evident audit record.
7. The prototype must run without internet after installation.
8. Government database, UIDAI, Passport Seva, visa, blacklist, and live watchlist access must be represented with mock local data only.
9. Do not use leaked identity data.
10. Use synthetic documents, public specimen datasets, or consented team data.
11. Do not claim production-level accuracy.
12. Clearly label prototype-only integrations and simulated data.
13. The UI must never display sensitive data unnecessarily.
14. The application must be usable by a checkpoint officer with minimal training.
15. Every AI result must show a reason, confidence, and recommended next action.

---

# 3. Technology stack

Use a stack that Antigravity can implement reliably.

## Frontend

- React
- TypeScript
- Vite
- Tailwind CSS
- Shadcn/ui or equivalent component library
- Lucide icons
- Recharts for dashboard charts
- PWA support for offline caching
- IndexedDB for temporary local browser storage

## Local application wrapper

Use one of these options:

- **Tauri** for a lightweight installed desktop application, preferred.
- Electron if Antigravity handles it more reliably.

The application should still render the React interface locally.

## Backend

- Python
- FastAPI
- Uvicorn
- Pydantic
- SQLAlchemy
- SQLite for the prototype
- PostgreSQL as a future production database
- Redis only if required for local sessions or background queues

## Document processing

- OpenCV
- Pillow
- Tesseract OCR or EasyOCR
- PassportEye or an ICAO MRZ parser
- Python MRZ checksum implementation
- DeepFace, InsightFace, or another locally runnable face embedding library
- A lightweight pretrained CNN such as MobileNetV2 or EfficientNet-Lite for prototype visual anomaly classification

## Security

- HTTPS/TLS when deployed across a local network
- JWT authentication
- Role-based access control
- bcrypt or Argon2 password hashing
- AES encryption for sensitive local files where practical
- SHA-256 hash chain for the prototype audit ledger
- Hyperledger Fabric only as a future government-scale permissioned ledger
- No public blockchain
- No cryptocurrency
- No raw biometric data on the ledger

## Offline storage

- SQLite for structured records
- Local encrypted file storage for uploaded images
- IndexedDB for temporary frontend state
- Local outbox queue for records waiting to synchronize
- Optional Redis for session management

---

# 4. Core application pages

Create these pages:

1. Login
2. Dashboard
3. New Screening
4. Document Capture
5. Processing Status
6. Screening Result
7. Manual Review Queue
8. Review Detail
9. Audit Ledger
10. Settings
11. Help and System Status

The interface must work when the network is disconnected.

---

# 5. Visual design system

Use a premium border-security operations style.

## Color palette

- Background: Jet Black `#0B0D0F`
- Secondary background: Graphite Fog `#15191D`
- Panel background: Dark Slate `#20262C`
- Border: Steel Gray `#35404A`
- Primary accent: Signal Amber `#F4B942`
- Secondary accent: Security Teal `#22C7B8`
- Warning: Alert Coral `#F06A5F`
- Success: Secure Green `#48D597`
- Text primary: Frost White `#F4F7F9`
- Text secondary: Ash Gray `#A8B3BC`
- Muted: `#68737D`

## Visual language

- Dark command-center interface.
- Large readable values.
- Clear status labels.
- Subtle grid texture in empty areas.
- Thin technical borders.
- Rounded panels, but not overly playful.
- Use amber for pending or review states.
- Use teal for verified states.
- Use coral for suspicious indicators.
- Avoid excessive neon effects.
- Avoid cartoon illustrations.
- Avoid generic banking-dashboard styling.
- Include checkpoint name, current operator, local time, and offline status in the top bar.

## Typography

Use a modern sans-serif such as:

- Inter
- IBM Plex Sans
- Manrope

Use monospaced text for:

- Document IDs
- MRZ text
- Hashes
- Timestamps
- Audit references

---

# 6. Prompt for Stitch

Paste the following prompt into Stitch:

```text
Design a premium offline-first border checkpoint document screening application called “MIC Alumni”.

The product is an authorized officer workstation for screening passports, visas, national identity cards, permits, and travel documents. It is not a citizen-facing app. It must feel like a professional border-security command interface designed for mountain and remote checkpoints.

Create a complete responsive UI system for these screens:

1. Login
2. Dashboard
3. New Screening
4. Document Capture
5. Processing Status
6. Screening Result: Recommended Clear
7. Screening Result: Manual Review Required
8. Manual Review Queue
9. Manual Review Detail
10. Audit Ledger
11. Settings and System Status
12. Help and Offline Mode

Visual style:

- Jet Black background: #0B0D0F
- Graphite Fog surfaces: #15191D
- Dark Slate panels: #20262C
- Steel Gray borders: #35404A
- Signal Amber: #F4B942
- Security Teal: #22C7B8
- Alert Coral: #F06A5F
- Secure Green: #48D597
- Frost White text: #F4F7F9
- Ash Gray secondary text: #A8B3BC

The design should look like a modern border-security operations console. Use a restrained premium style, strong information hierarchy, technical data panels, subtle grid textures, thin borders, compact status chips, large readable risk scores, and clear action buttons. Do not make it look like a banking app, social app, medical app, or generic admin template.

The application must visibly support offline operation. Always show:

- Checkpoint name
- Current officer identity
- Current local time
- Online or Offline status
- Last synchronization time
- Number of records waiting to sync
- Local processing status

Important product behavior:

- The application does not automatically reject a person.
- A failed or uncertain check produces “Manual Review Required”.
- A high-confidence result produces “Recommended Clear”.
- The final decision belongs to the authorized officer.
- Raw identity images must not be shown unnecessarily.
- Blockchain is represented as a tamper-evident audit ledger, not a cryptocurrency interface.

Screen requirements:

Login:
- MIC Alumni logo
- Officer ID
- Password
- Optional local MFA code
- Checkpoint selector
- Offline login indicator
- Secure local authentication message

Dashboard:
- Total screenings today
- Recommended clear
- Manual reviews
- Capture retries
- Pending offline sync records
- Average processing time
- Risk distribution chart
- Recent screening activity
- “Start New Screening” primary button
- “Open Review Queue” secondary button

New Screening:
- Select document type:
  Passport, Visa, National ID, Permit, Driving License, Other
- Start camera capture
- Upload local image
- Scan from connected device
- Display capture-quality requirements

Document Capture:
- Large camera/document preview
- Border alignment guide
- Four-corner detection
- Blur indicator
- Lighting and glare indicator
- Document distance indicator
- Capture button
- Retake button
- “Image quality accepted” status
- Explain that poor capture quality triggers a retake, not document rejection

Processing Status:
Show sequential or parallel processing cards:

- Image quality check
- OCR extraction
- MRZ or barcode parsing
- MRZ checksum validation
- Field and date consistency
- Local watchlist lookup
- Visual tampering analysis
- Face verification
- Explainable risk calculation
- Audit record creation

Show progress without pretending every step is a trained AI model.

Screening Result: Recommended Clear:
- Large green or teal “Recommended Clear” status
- Risk score
- Confidence score
- Extracted document fields
- MRZ validation result
- Document consistency result
- Tampering analysis result
- Face verification result
- Local database result
- Reasons supporting the result
- Officer action buttons:
  Confirm Clear
  Send to Manual Review
- Do not show an automatic rejection button

Screening Result: Manual Review Required:
- Large amber/coral “Manual Review Required” status
- Clear reasons for escalation
- Failed or uncertain checks
- Document image with suspicious region overlays
- Extracted fields next to source image
- Face comparison panel
- MRZ comparison panel
- Officer notes box
- Buttons:
  Confirm Clear
  Mark Suspicious
  Request Retake
  Escalate to Supervisor

Manual Review Queue:
- Queue table with:
  Case ID
  Document type
  Risk score
  Escalation reason
  Capture time
  Current status
  Assigned officer
- Filters for:
  High risk
  Low image quality
  Face mismatch
  MRZ failure
  Tamper indicator
  Offline pending
- Clear priority indicators

Manual Review Detail:
- Split-screen layout
- Source document image
- Cropped suspicious regions
- Extracted data
- Validation results
- Face comparison
- Officer notes
- Review history
- Final officer decision
- Mandatory reason for override
- Audit record preview

Audit Ledger:
- Readable audit table
- Case ID
- Timestamp
- Officer ID
- Checkpoint
- Risk score
- Decision
- Record hash
- Previous hash
- Ledger status:
  Local
  Queued for Sync
  Synchronized
- Search and filtering
- Export a redacted audit report
- Do not expose raw biometric images in the ledger

Settings and System Status:
- Model status
- Local database status
- Storage usage
- Camera status
- OCR status
- Offline mode
- Last synchronization
- Pending sync count
- User role
- Security settings
- Data retention configuration

Help and Offline Mode:
- Explain what works offline
- Explain what waits for synchronization
- Explain that offline watchlist data may be older than the central copy
- Explain that uncertain cases go to manual review
- Explain that the system assists officers and does not make irreversible decisions

Use realistic specimen data only. Do not use real Aadhaar, passport, PAN, or leaked identity data. Label all sample documents as DEMO or SPECIMEN.

Generate all screens with the same design system, navigation, colors, spacing, components, status language, and visual hierarchy. The final result should feel like a deployable government security product prototype.
```

---

# 7. Prompt for Antigravity

After generating the UI in Stitch, paste this prompt into Antigravity:

```text
Build the MIC Alumni offline-first document screening application using the Stitch UI screens as the visual source of truth.

Do not redesign the UI unnecessarily. Preserve the Stitch colors, layouts, spacing, typography, status labels, navigation, and dashboard structure.

Application type:

- Installed local desktop application
- React and TypeScript frontend
- Tauri preferred for packaging
- Python FastAPI local backend
- SQLite local database
- Local file storage for specimen document images
- PWA-style offline caching where useful

The app must run on a basic laptop without internet after installation.

Core workflow:

1. Officer signs in using local authentication.
2. Officer starts a new screening case.
3. Officer selects document type.
4. Officer captures an image using a webcam or uploads a local specimen image.
5. The application checks capture quality:
   - blur
   - brightness
   - glare
   - document boundary
   - perspective
   - image resolution
6. If capture quality is poor, show “Retake Required”.
7. Do not classify a poor image as a fake document.
8. Run OCR locally.
9. Extract:
   - name
   - document number
   - nationality
   - date of birth
   - gender where available
   - issue date where available
   - expiry date
   - visa number
   - visa type
   - entry validity
   - stay duration
10. Detect and parse MRZ where available.
11. Validate MRZ checksums using deterministic ICAO-style calculation.
12. Run field and document consistency checks:
   - required fields present
   - valid date formats
   - expiry date after issue date
   - plausible date of birth
   - passport number format
   - visa date consistency
   - cross-field consistency
13. Run local mock watchlist lookup using seeded specimen data.
14. Run local visual tampering analysis.
15. The prototype tampering analyzer must use a clear baseline implementation:
   - image preprocessing
   - document alignment
   - suspicious-region analysis
   - a lightweight pretrained or fine-tuned image classifier if available
   - confidence result
   - explanation
16. Do not claim that the model detects every expert-level forgery.
17. Use ELA and EXIF only as optional experimental signals. Do not depend on them for the final decision.
18. Run local face verification only when the officer captures a consented demo face image.
19. Do not store unnecessary biometric images permanently.
20. Produce an explainable risk score from the separate signals.
21. If confidence is high and no critical inconsistency exists, show:
   “Recommended Clear”.
22. If any important check fails or confidence is low, show:
   “Manual Review Required”.
23. Never automatically reject a person.
24. The officer must make the final decision.
25. Record the final decision, reason, officer ID, timestamp, risk score, and model results.
26. Create a tamper-evident local audit record using SHA-256 hash chaining.
27. Store only the audit hash and metadata in the ledger record.
28. Store raw document images separately under local encrypted or access-controlled storage.
29. Show ledger status:
   - Local
   - Queued for Sync
   - Synchronized
30. If internet is unavailable:
   - Continue OCR
   - Continue MRZ validation
   - Continue document validation
   - Continue tampering analysis
   - Continue face verification
   - Continue risk scoring
   - Store the audit record locally
   - Queue synchronization for later
31. When connectivity returns, synchronize queued records.
32. Do not block the officer while synchronization occurs.
33. Do not call UIDAI, Passport Seva, DigiLocker, DigiYatra, or any government system.
34. Use mock local databases and clearly label them as demonstration data.
35. Do not use leaked databases or real identity records.

Required backend modules:

backend/
  app/
    main.py
    config.py
    database.py
    models/
    schemas/
    routes/
      auth.py
      cases.py
      capture.py
      ocr.py
      validation.py
      tampering.py
      face_verification.py
      scoring.py
      audit.py
      sync.py
      health.py
    services/
      ocr_service.py
      mrz_service.py
      validation_service.py
      image_quality_service.py
      tampering_service.py
      face_service.py
      scoring_service.py
      audit_service.py
      sync_service.py
    security/
      auth.py
      permissions.py
      encryption.py
    tests/

Required frontend modules:

frontend/
  src/
    app/
    components/
      layout/
      dashboard/
      capture/
      processing/
      results/
      review/
      audit/
      common/
    pages/
    services/
    hooks/
    types/
    stores/
    styles/
    offline/
    utils/

Required screens:

- Login
- Dashboard
- New Screening
- Document Capture
- Processing Status
- Screening Result
- Manual Review Queue
- Manual Review Detail
- Audit Ledger
- Settings
- System Status
- Help

Required API endpoints:

POST /auth/login
POST /auth/logout
GET /auth/me
POST /cases
GET /cases/{case_id}
POST /cases/{case_id}/capture
POST /cases/{case_id}/ocr
POST /cases/{case_id}/validate
POST /cases/{case_id}/tamper-analysis
POST /cases/{case_id}/face-verification
POST /cases/{case_id}/calculate-risk
POST /cases/{case_id}/decision
GET /cases
GET /review-queue
POST /review-queue/{case_id}/review
GET /audit-records
GET /audit-records/{case_id}
POST /sync
GET /system/status

Database tables:

users
roles
checkpoints
screening_cases
document_images
ocr_results
mrz_results
validation_results
tamper_results
face_results
risk_scores
review_decisions
audit_records
sync_queue
mock_watchlist
system_events

Seed the database with:

- One demo admin account
- One demo officer account
- Several synthetic document cases
- One clean case
- One blurry case
- One MRZ checksum failure
- One expired document
- One inconsistent date case
- One suspected photo replacement
- One face mismatch case
- One case waiting for synchronization

Use visibly fake specimen identities. Never use real personal information.

Risk-scoring example:

- Image quality: 10%
- MRZ/checksum validation: 20%
- Field consistency: 15%
- Expiry and document rules: 15%
- Local watchlist result: 15%
- Visual tamper analysis: 15%
- Face verification: 10%

Make the weights configurable and display the reasons behind the score.

Do not convert a score directly into an automatic rejection.

Offline behavior:

- Detect navigator online/offline status.
- Display status in the top navigation.
- Save unsynchronized cases locally.
- Allow the officer to continue screening offline.
- Provide an outbox count.
- Retry synchronization in the background.
- Prevent duplicate records during synchronization.
- Use idempotent synchronization IDs.
- Display “Last synchronized at” time.
- Display “Local data may be older than central data” for mock watchlist data.

Security requirements:

- Hash passwords with Argon2 or bcrypt.
- Use role-based permissions.
- Require an authenticated user for all case and audit operations.
- Sanitize file uploads.
- Restrict uploaded file types.
- Limit file size.
- Never execute uploaded files.
- Do not expose internal stack traces in the UI.
- Redact sensitive fields in logs.
- Do not place raw biometric data in audit hashes.
- Add automatic local session timeout.
- Require an explanation for officer overrides.
- Record every override as an audit event.

Demo requirements:

Create a guided demo mode with three cases:

Case 1: Clean specimen:
- Good image quality
- Valid OCR
- Valid MRZ
- Valid dates
- No tamper signal
- Strong face match
- Result: Recommended Clear

Case 2: Tampered specimen:
- Edited name or replaced photo in a synthetic document
- OCR still extracts text
- One validation or tamper signal is suspicious
- Result: Manual Review Required
- Show the reason clearly

Case 3: Poor capture:
- Blurry or overexposed image
- Result: Retake Required
- Do not label it as fraud

Add a visible “Demo Data” label throughout the prototype.

Testing requirements:

- Test the API routes.
- Test MRZ checksum validation.
- Test date and expiry rules.
- Test image-quality rejection and retake flow.
- Test manual-review escalation.
- Test no-auto-reject behavior.
- Test offline case creation.
- Test queue synchronization.
- Test duplicate synchronization prevention.
- Test role permissions.
- Test audit hash-chain integrity.
- Test that raw images are not inserted into audit records.

Documentation requirements:

Create:

README.md
SETUP.md
OFFLINE_MODE.md
ARCHITECTURE.md
SECURITY.md
DATA_AND_PRIVACY.md
MODEL_LIMITATIONS.md
DEMO_SCRIPT.md
API.md
TESTING.md

In the documentation clearly state:

- This is a prototype.
- Government integrations are mocked.
- No real Aadhaar, passport, PAN, or leaked data is used.
- AI output is advisory.
- Human review is mandatory for uncertain cases.
- Hyperledger Fabric is future production scope.
- The current prototype uses a local SHA-256 hash chain to demonstrate tamper-evident auditing.
- VSC or other forensic hardware is future integration scope.
- ELA and EXIF are optional supporting signals and are not the core detector.
- The core prototype demonstrates OCR, MRZ validation, rule validation, local anomaly/tamper analysis, face verification, offline operation, explainable risk scoring, human review, and audit logging.

Before finishing:

1. Run the backend locally.
2. Run the frontend locally.
3. Confirm the app works with the network disabled.
4. Confirm all demo cases work.
5. Confirm records remain available after restarting the application.
6. Confirm offline records synchronize when connectivity returns.
7. Confirm all pages use the Stitch design consistently.
8. Confirm no screen contains placeholder text such as “Lorem ipsum”.
9. Confirm the app never displays a false claim that it connects to UIDAI or another government database.
10. Confirm the final UI is presentation-ready for a Smart India Hackathon prototype demonstration.
```

---

# 8. Recommended build order

Give Antigravity the full prompt, but build and verify in this order:

1. Generate the UI with Stitch.
2. Create the React navigation and all pages.
3. Add local login and roles.
4. Add SQLite and case creation.
5. Add document upload and camera capture.
6. Add image-quality checks.
7. Add OCR.
8. Add MRZ parsing and checksum validation.
9. Add field and date validation.
10. Add seeded mock watchlist lookup.
11. Add baseline tampering analysis.
12. Add face verification with specimen images.
13. Add risk scoring.
14. Add manual-review workflow.
15. Add local hash-chain audit records.
16. Add offline queue and synchronization.
17. Add demo data and guided demo mode.
18. Test the complete flow.
19. Package the application for local use.

The first working milestone should be:

> Upload specimen document → extract fields → validate MRZ and dates → show risk result → send uncertain case to manual review → save local audit record.

Do not wait for advanced model training before creating this complete end-to-end flow. A working pipeline with clearly labeled prototype models will be more useful for your demonstration than an unfinished advanced model.

# 9. Prototype scope

The prototype must demonstrate these features:

- Officer login.
- Offline dashboard.
- Document capture or upload.
- Capture-quality feedback.
- OCR extraction.
- MRZ checksum validation where applicable.
- Field and date consistency checks.
- Expired-document detection.
- Mock watchlist check.
- Basic visual tampering or anomaly analysis.
- Face comparison using consented specimen data.
- Explainable risk score.
- Manual-review escalation.
- Local audit hash chain.
- Offline storage and queued synchronization.
- Premium officer-facing UI.

The following remain future scope:

- Live UIDAI or Passport Seva integration.
- Live international watchlists.
- Production government identity databases.
- ICAO chip and PKI integration.
- VSC or multispectral forensic hardware.
- Large-scale trained forgery models.
- Nationwide permissioned Hyperledger Fabric deployment.
- Production-grade biometric infrastructure.
- Fully automatic legal rejection decisions.