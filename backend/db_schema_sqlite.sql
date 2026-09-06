-- ============================================================
-- DocuShield SQLite Database Schema (Embedded & Zero-Setup)
-- ============================================================
-- All scan images are stored directly as BLOB (JPEG bytes).
-- Tables and indexes are automatically created by setup_db.py or server.py.
-- ============================================================

-- 1. Officers Table
CREATE TABLE IF NOT EXISTS officers (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    officer_id      TEXT UNIQUE NOT NULL,
    full_name       TEXT NOT NULL,
    rank            TEXT,
    checkpoint_id   TEXT,
    badge_number    TEXT,
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed Default Officer
INSERT INTO officers (officer_id, full_name, rank, checkpoint_id, badge_number)
VALUES ('SSB-7489-N', 'Inspector Rameshwar Singh', 'Inspector / Screening Lead', 'CP-04-NORTH', 'SSB-VET-441')
ON CONFLICT (officer_id) DO NOTHING;

-- 2. Scanned Documents Table
CREATE TABLE IF NOT EXISTS scanned_documents (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id             TEXT UNIQUE NOT NULL,
    traveler_name       TEXT,
    nationality         TEXT,
    date_of_birth       TEXT,
    sex                 TEXT,
    document_number     TEXT,
    document_type       TEXT,
    expiry_date         TEXT,
    issue_date          TEXT,
    mrz_line_1          TEXT,
    mrz_line_2          TEXT,
    document_image      BLOB,
    image_mime_type     TEXT DEFAULT 'image/jpeg',
    image_size_bytes    INTEGER,
    checkpoint_id       TEXT,
    officer_id          TEXT REFERENCES officers(officer_id),
    scanned_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_status         TEXT DEFAULT 'LOCAL_PENDING'
);

-- 3. Analysis Results Table
CREATE TABLE IF NOT EXISTS analysis_results (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id             TEXT REFERENCES scanned_documents(scan_id) ON DELETE CASCADE,
    risk_score          INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    confidence          INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    quality_gate        TEXT,
    ocr_result          TEXT,
    mrz_validation      TEXT,
    field_consistency   TEXT,
    chronology_logic    TEXT,
    tamper_detection    TEXT,
    face_match          TEXT,
    injection_defense   TEXT,
    anomalies           TEXT,
    processing_time_ms  INTEGER,
    analyzed_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 4. Decisions Table
CREATE TABLE IF NOT EXISTS decisions (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    scan_id             TEXT REFERENCES scanned_documents(scan_id) ON DELETE CASCADE,
    decision            TEXT NOT NULL,
    officer_id          TEXT REFERENCES officers(officer_id),
    officer_notes       TEXT,
    reasons             TEXT,
    ledger_block_index  INTEGER,
    ledger_hash         TEXT,
    decided_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 5. Audit Log Table
CREATE TABLE IF NOT EXISTS audit_log (
    id                  INTEGER PRIMARY KEY AUTOINCREMENT,
    action_type         TEXT NOT NULL,
    scan_id             TEXT,
    officer_id          TEXT,
    details             TEXT,
    ip_address          TEXT,
    timestamp           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Performance Indexes
CREATE INDEX IF NOT EXISTS idx_scanned_docs_officer ON scanned_documents(officer_id);
CREATE INDEX IF NOT EXISTS idx_scanned_docs_date ON scanned_documents(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_analysis_risk ON analysis_results(risk_score);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp DESC);
