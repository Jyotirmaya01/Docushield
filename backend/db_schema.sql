-- ============================================================
-- DocuShield PostgreSQL Database Schema
-- AI-Based Fake Identity & Document Screening System
-- SIH Problem Statement 26188
-- ============================================================

-- Create database (run this separately as postgres superuser)
-- CREATE DATABASE docushield;

-- ============================================================
-- 1. OFFICERS TABLE — Border security personnel
-- ============================================================
CREATE TABLE IF NOT EXISTS officers (
    id              SERIAL PRIMARY KEY,
    officer_id      VARCHAR(20) UNIQUE NOT NULL,    -- e.g. 'SSB-7489-N'
    full_name       VARCHAR(100) NOT NULL,
    rank            VARCHAR(50),
    checkpoint_id   VARCHAR(30),                     -- e.g. 'CP-04-NORTH'
    badge_number    VARCHAR(20),
    created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Seed the default officer
INSERT INTO officers (officer_id, full_name, rank, checkpoint_id, badge_number)
VALUES ('SSB-7489-N', 'Inspector Rameshwar Singh', 'Inspector / Screening Lead', 'CP-04-NORTH', 'SSB-VET-441')
ON CONFLICT (officer_id) DO NOTHING;


-- ============================================================
-- 2. SCANNED DOCUMENTS TABLE — Every document scan record
-- ============================================================
CREATE TABLE IF NOT EXISTS scanned_documents (
    id                  SERIAL PRIMARY KEY,
    scan_id             VARCHAR(36) UNIQUE NOT NULL,     -- UUID for each scan
    
    -- Traveler information (extracted by OCR / MRZ)
    traveler_name       VARCHAR(150),
    nationality         VARCHAR(10),                      -- ICAO 3-letter code
    date_of_birth       DATE,
    sex                 VARCHAR(5),
    document_number     VARCHAR(30),
    document_type       VARCHAR(30),                      -- PASSPORT, VISA, NATIONAL_ID, etc.
    expiry_date         DATE,
    issue_date          DATE,
    
    -- MRZ raw lines (if passport/visa)
    mrz_line_1          VARCHAR(50),
    mrz_line_2          VARCHAR(50),
    
    -- Document image stored as JPEG binary
    document_image      BYTEA,                            -- The captured image in JPEG format
    image_mime_type     VARCHAR(30) DEFAULT 'image/jpeg',
    image_size_bytes    INTEGER,
    
    -- Metadata
    checkpoint_id       VARCHAR(30),
    officer_id          VARCHAR(20) REFERENCES officers(officer_id),
    scanned_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sync_status         VARCHAR(20) DEFAULT 'LOCAL_PENDING'  -- LOCAL_PENDING | SYNCED
);


-- ============================================================
-- 3. ANALYSIS RESULTS TABLE — Pipeline risk analysis per scan
-- ============================================================
CREATE TABLE IF NOT EXISTS analysis_results (
    id                  SERIAL PRIMARY KEY,
    scan_id             VARCHAR(36) REFERENCES scanned_documents(scan_id) ON DELETE CASCADE,
    
    -- Overall scores
    risk_score          INTEGER NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
    confidence          INTEGER NOT NULL CHECK (confidence BETWEEN 0 AND 100),
    
    -- Pipeline stage results (JSON for flexibility)
    quality_gate        JSONB,          -- { passed, laplacianVariance, overexposedPct }
    ocr_result          JSONB,          -- { passed, extractedCount, fields }
    mrz_validation      JSONB,          -- { isValid, checks[], fullName, documentNumber, ... }
    field_consistency   JSONB,          -- { passed, discrepancies[] }
    chronology_logic    JSONB,          -- { passed, errors[] }
    tamper_detection    JSONB,          -- { passed, tamperProbability, metrics }
    face_match          JSONB,          -- { passed, matchPercentage, threshold }
    injection_defense   JSONB,          -- { passed, detectedPatterns[] }
    
    -- Anomalies list
    anomalies           JSONB,          -- Array of { severity, module, description, impact }
    
    -- Processing time
    processing_time_ms  INTEGER,
    
    analyzed_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 4. DECISIONS TABLE — Officer decisions (approve/deny/escalate)
-- ============================================================
CREATE TABLE IF NOT EXISTS decisions (
    id                  SERIAL PRIMARY KEY,
    scan_id             VARCHAR(36) REFERENCES scanned_documents(scan_id) ON DELETE CASCADE,
    
    -- Decision
    decision            VARCHAR(30) NOT NULL,   -- AUTO_APPROVED | ESCALATED_SECONDARY | OFFICER_OVERRIDE | DENIED
    officer_id          VARCHAR(20) REFERENCES officers(officer_id),
    officer_notes       TEXT,                   -- Mandatory justification for overrides/denials
    
    -- Reasons (from pipeline or officer)
    reasons             JSONB,                  -- Array of reason strings
    
    -- Blockchain anchor
    ledger_block_index  INTEGER,
    ledger_hash         VARCHAR(64),            -- SHA-256 hash from hash-chain
    
    decided_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- 5. AUDIT LOG TABLE — Immutable record of all actions
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_log (
    id                  SERIAL PRIMARY KEY,
    action_type         VARCHAR(30) NOT NULL,   -- SCAN | DECISION | LOGIN | OVERRIDE | DENY | SYNC
    scan_id             VARCHAR(36),
    officer_id          VARCHAR(20),
    details             JSONB,
    ip_address          VARCHAR(45),
    timestamp           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);


-- ============================================================
-- INDEXES for fast queries
-- ============================================================
CREATE INDEX IF NOT EXISTS idx_scanned_docs_officer ON scanned_documents(officer_id);
CREATE INDEX IF NOT EXISTS idx_scanned_docs_date ON scanned_documents(scanned_at DESC);
CREATE INDEX IF NOT EXISTS idx_scanned_docs_nationality ON scanned_documents(nationality);
CREATE INDEX IF NOT EXISTS idx_analysis_risk ON analysis_results(risk_score);
CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision);
CREATE INDEX IF NOT EXISTS idx_decisions_date ON decisions(decided_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_log(action_type);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp DESC);
