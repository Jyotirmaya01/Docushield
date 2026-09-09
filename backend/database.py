"""
DocuShield Database Layer — SQLite Version (Embedded & Zero-Setup)
Handles SQLite connection, table creation, and all CRUD operations.
Stores JPEG document images as binary BLOBs and metadata in a single local database file.
"""
import sqlite3
import json
import os
from contextlib import contextmanager
from datetime import datetime, date
from config import DB_PATH


def dict_factory(cursor, row):
    """Convert sqlite row to dictionary."""
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d


def _parse_json_field(val):
    """Safely decode JSON strings stored in TEXT columns."""
    if val is None:
        return None
    if isinstance(val, (dict, list)):
        return val
    try:
        return json.loads(val)
    except (json.JSONDecodeError, TypeError):
        return val


@contextmanager
def get_db():
    """Context manager for SQLite database connections."""
    os.makedirs(os.path.dirname(os.path.abspath(DB_PATH)), exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_database():
    """Create all SQLite tables and indexes if they don't exist."""
    with get_db() as conn:
        cur = conn.cursor()

        # Officers table with password and status
        cur.execute("""
            CREATE TABLE IF NOT EXISTS officers (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                officer_id      TEXT UNIQUE NOT NULL,
                full_name       TEXT NOT NULL,
                rank            TEXT,
                checkpoint_id   TEXT,
                badge_number    TEXT,
                password_hash   TEXT,
                status          TEXT DEFAULT 'ACTIVE',
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Check existing table columns (safe migration)
        cur.execute("PRAGMA table_info(officers)")
        cols = [r['name'] for r in cur.fetchall()]
        if 'password_hash' not in cols:
            cur.execute("ALTER TABLE officers ADD COLUMN password_hash TEXT")
        if 'status' not in cols:
            cur.execute("ALTER TABLE officers ADD COLUMN status TEXT DEFAULT 'ACTIVE'")
        if 'name' not in cols:
            cur.execute("ALTER TABLE officers ADD COLUMN name TEXT")
            cur.execute("UPDATE officers SET name = full_name WHERE name IS NULL")
        if 'role' not in cols:
            cur.execute("ALTER TABLE officers ADD COLUMN role TEXT DEFAULT 'officer'")

        # Admins table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS admins (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                admin_id        TEXT UNIQUE NOT NULL,
                full_name       TEXT NOT NULL,
                role            TEXT DEFAULT 'ADMIN',
                password_hash   TEXT NOT NULL,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # SHA-256 for default passwords
        import hashlib
        officer_pw_hash = hashlib.sha256("882194".encode()).hexdigest()
        admin_pw_hash = hashlib.sha256("admin".encode()).hexdigest()

        # Seed default officers
        officers_to_seed = [
            ('SSB-7489-N', 'Inspector Rameshwar Singh', 'Inspector / Screening Lead', 'CP-04-NORTH', 'SSB-VET-441'),
            ('SSB-5521-N', 'Sub-Insp. Ananya Verma', 'Sub-Inspector / Biometrics', 'CP-04-NORTH', 'SSB-VET-812'),
            ('SSB-9204-N', 'Asst. Sub-Insp. Vikram Adhikari', 'ASI / Document Verification', 'CP-02-RAXAUL', 'SSB-SEC-902'),
        ]
        for oid, name, rank, cp, badge in officers_to_seed:
            cur.execute("""
                INSERT INTO officers (officer_id, full_name, rank, checkpoint_id, badge_number, password_hash, status)
                VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
                ON CONFLICT (officer_id) DO UPDATE SET 
                    password_hash = excluded.password_hash,
                    full_name = excluded.full_name,
                    rank = excluded.rank,
                    checkpoint_id = excluded.checkpoint_id,
                    badge_number = excluded.badge_number
            """, (oid, name, rank, cp, badge, officer_pw_hash))

        # Seed default admin
        cur.execute("""
            INSERT INTO admins (admin_id, full_name, role, password_hash)
            VALUES ('ADMIN-01', 'Sector Commander Rajesh Joshi', 'ADMIN', ?)
            ON CONFLICT (admin_id) DO UPDATE SET password_hash = excluded.password_hash
        """, (admin_pw_hash,))

        # Scanned documents table — stores images as JPEG BLOB
        cur.execute("""
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
            )
        """)

        # Analysis results table
        cur.execute("""
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
            )
        """)

        # Decisions table
        cur.execute("""
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
            )
        """)

        # Audit Log Table (Specification Compliant Central Hash-Chain Aggregation)
        cur.execute("PRAGMA table_info(audit_log)")
        audit_cols = [r['name'] for r in cur.fetchall()]
        if 'entry_hash' not in audit_cols:
            if 'action_type' in audit_cols:
                cur.execute("ALTER TABLE audit_log RENAME TO legacy_system_audit_log")
            cur.execute("""
                CREATE TABLE IF NOT EXISTS audit_log (
                    entry_id        INTEGER PRIMARY KEY AUTOINCREMENT,
                    record_id       TEXT NOT NULL,
                    timestamp       DATETIME NOT NULL,
                    officer_id      TEXT NOT NULL,
                    checkpoint_id   TEXT NOT NULL,
                    risk_score      REAL,
                    decision        TEXT NOT NULL,
                    prior_hash      TEXT NOT NULL,
                    entry_hash      TEXT NOT NULL,
                    received_at     DATETIME DEFAULT CURRENT_TIMESTAMP
                )
            """)

        # Checkpoints Table (Checkpoint Management)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS checkpoints (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                checkpoint_id   TEXT UNIQUE NOT NULL,
                name            TEXT NOT NULL,
                sector          TEXT,
                location        TEXT,
                active          BOOLEAN DEFAULT 1,
                status          TEXT DEFAULT 'ACTIVE',
                registered_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Ensure active column exists if table was previously created
        cur.execute("PRAGMA table_info(checkpoints)")
        cp_cols = [r['name'] for r in cur.fetchall()]
        if 'active' not in cp_cols:
            cur.execute("ALTER TABLE checkpoints ADD COLUMN active BOOLEAN DEFAULT 1")
            cur.execute("UPDATE checkpoints SET active = 1 WHERE active IS NULL")

        # Seed initial checkpoints
        checkpoints_to_seed = [
            ('CP-04-NORTH', 'Panitanki Border Checkpoint', 'SECTOR-04', 'Siliguri / Nepal Border', 'ACTIVE'),
            ('CP-02-RAXAUL', 'Raxaul Border Gateway', 'SECTOR-02', 'Bihar / Birgunj Gateway', 'ACTIVE'),
            ('CP-01-WEST', 'Birgunj Border Station', 'SECTOR-01', 'Parsa Sector', 'ACTIVE'),
            ('CP-08-EAST', 'Kakrahwa Border Post', 'SECTOR-08', 'Siddharthnagar Corridor', 'ACTIVE')
        ]
        for cid, name, sec, loc, stat in checkpoints_to_seed:
            cur.execute("""
                INSERT INTO checkpoints (checkpoint_id, name, sector, location, status, active)
                VALUES (?, ?, ?, ?, ?, 1)
                ON CONFLICT (checkpoint_id) DO UPDATE SET
                    name = excluded.name,
                    sector = excluded.sector,
                    location = excluded.location,
                    status = excluded.status,
                    active = 1
            """, (cid, name, sec, loc, stat))

        # Document Ledger (Master Ledger, source of truth for fast-lane)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS document_ledger (
                document_id                 TEXT PRIMARY KEY,
                status                      TEXT DEFAULT 'unknown',
                crossing_count              INTEGER DEFAULT 0,
                last_checkpoint_id          TEXT,
                last_crossing_timestamp     DATETIME,
                flagged_reason              TEXT
            )
        """)

        # Seed initial frequent crossers for fast-lane demonstration
        doc_seeds = [
            ('NP-FC-991204', 'approved', 14, 'CP-04-NORTH', None),
            ('IND-FL-402911', 'flagged', 2, 'CP-04-NORTH', 'Suspected biometric mismatch / forged stamp')
        ]
        for did, stat, cnt, cp, reason in doc_seeds:
            cur.execute("""
                INSERT INTO document_ledger (document_id, status, crossing_count, last_checkpoint_id, last_crossing_timestamp, flagged_reason)
                VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
                ON CONFLICT (document_id) DO UPDATE SET
                    status = excluded.status,
                    crossing_count = excluded.crossing_count,
                    last_checkpoint_id = excluded.last_checkpoint_id
            """, (did, stat, cnt, cp, reason))

        # On-Device (Local) Normalized Schema Tables:
        cur.execute("""
            CREATE TABLE IF NOT EXISTS scans (
                record_id       TEXT PRIMARY KEY,
                checkpoint_id   TEXT,
                officer_id      TEXT,
                timestamp       DATETIME,
                image_path      TEXT,
                document_type   TEXT,
                status          TEXT
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS extracted_fields (
                record_id       TEXT PRIMARY KEY,
                document_type   TEXT,
                name            TEXT,
                date_of_birth   DATE,
                document_number TEXT,
                nationality     TEXT,
                gender          TEXT,
                issue_date      DATE,
                expiry_date     DATE,
                mrz_raw         TEXT,
                extra_fields    TEXT,
                FOREIGN KEY (record_id) REFERENCES scans(record_id)
            )
        """)

        # Ensure flexible columns exist if table was previously created
        cur.execute("PRAGMA table_info(extracted_fields)")
        existing_extracted_cols = [r[1] for r in cur.fetchall()]
        if 'document_type' not in existing_extracted_cols:
            cur.execute("ALTER TABLE extracted_fields ADD COLUMN document_type TEXT")
        if 'extra_fields' not in existing_extracted_cols:
            cur.execute("ALTER TABLE extracted_fields ADD COLUMN extra_fields TEXT")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS validation_results (
                record_id               TEXT PRIMARY KEY,
                validation_passed       BOOLEAN,
                mrz_checksum_passed     BOOLEAN,
                field_format_passed     BOOLEAN,
                date_logic_passed       BOOLEAN,
                photo_validation_passed BOOLEAN,
                failure_reasons         TEXT,
                FOREIGN KEY (record_id) REFERENCES scans(record_id)
            )
        """)

        # Migration: ensure validation_passed & photo_validation_passed exist if table pre-existed
        cur.execute("PRAGMA table_info(validation_results)")
        existing_val_cols = [c[1] for c in cur.fetchall()]
        if 'validation_passed' not in existing_val_cols:
            cur.execute("ALTER TABLE validation_results ADD COLUMN validation_passed BOOLEAN")
        if 'photo_validation_passed' not in existing_val_cols:
            cur.execute("ALTER TABLE validation_results ADD COLUMN photo_validation_passed BOOLEAN")

        cur.execute("""
            CREATE TABLE IF NOT EXISTS detection_scores (
                record_id           TEXT PRIMARY KEY,
                tamper_score        REAL,
                face_match_score    REAL,
                hidden_text_flag    BOOLEAN,
                risk_score          REAL,
                decision            TEXT,
                FOREIGN KEY (record_id) REFERENCES scans(record_id)
            )
        """)

        cur.execute("""
            CREATE TABLE IF NOT EXISTS ledger_cache (
                document_id         TEXT PRIMARY KEY,
                last_status         TEXT,
                crossing_count      INTEGER,
                last_seen_timestamp DATETIME,
                last_sync_timestamp DATETIME
            )
        """)

        # Frequent-Crosser Central Ledger Table (Compatibility alias)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS central_ledger (
                id              INTEGER PRIMARY KEY AUTOINCREMENT,
                document_id     TEXT UNIQUE NOT NULL,
                traveler_name   TEXT,
                nationality     TEXT,
                status          TEXT DEFAULT 'unknown',
                crossing_count  INTEGER DEFAULT 0,
                last_crossing   TIMESTAMP,
                last_checkpoint_id TEXT,
                last_officer_id TEXT,
                updated_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Seed initial frequent crossers for fast-lane demonstration
        ledger_seeds = [
            ('NP-FC-991204', 'RAMESH THAPA', 'NPL', 'approved', 14, 'CP-04-NORTH', 'SSB-7489-N'),
            ('IND-FL-402911', 'VIKRAM SINGH', 'IND', 'flagged', 2, 'CP-04-NORTH', 'SSB-7489-N')
        ]
        for did, name, nat, stat, cnt, cp, off in ledger_seeds:
            cur.execute("""
                INSERT INTO central_ledger (document_id, traveler_name, nationality, status, crossing_count, last_checkpoint_id, last_officer_id, last_crossing)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
                ON CONFLICT (document_id) DO NOTHING
            """, (did, name, nat, stat, cnt, cp, off))

        # Central Audit Log Sync Table (Metadata and Decision Records Only — No Document Images)
        cur.execute("""
            CREATE TABLE IF NOT EXISTS sync_audit_log (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                record_id           TEXT UNIQUE NOT NULL,
                checkpoint_id       TEXT NOT NULL,
                officer_id          TEXT NOT NULL,
                timestamp           TEXT NOT NULL,
                risk_score          INTEGER,
                decision            TEXT NOT NULL,
                prior_hash          TEXT NOT NULL,
                entry_hash          TEXT NOT NULL,
                traveler_name       TEXT,
                nationality         TEXT,
                pathway             TEXT,
                verification_status TEXT DEFAULT 'VERIFIED',
                synced_at           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # User Sessions Table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS user_sessions (
                token           TEXT PRIMARY KEY,
                user_id         TEXT NOT NULL,
                role            TEXT NOT NULL,
                checkpoint_id   TEXT,
                created_at      TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                expires_at      TIMESTAMP
            )
        """)

        # Create indexes
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scanned_docs_officer ON scanned_documents(officer_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scanned_docs_date ON scanned_documents(scanned_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_analysis_risk ON analysis_results(risk_score)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sync_audit_checkpoint ON sync_audit_log(checkpoint_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_sync_audit_time ON sync_audit_log(timestamp DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_central_ledger_doc ON central_ledger(document_id)")

        print(f"[DB] SQLite database initialized at: {DB_PATH}")


# ============================================================
# CRUD Operations
# ============================================================

def insert_scan(scan_data: dict, image_bytes: bytes | None = None) -> dict:
    """
    Insert a new document scan record with optional JPEG image.
    Returns the created record summary.
    """
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO scanned_documents 
            (scan_id, traveler_name, nationality, date_of_birth, sex,
             document_number, document_type, expiry_date, issue_date,
             mrz_line_1, mrz_line_2, document_image, image_mime_type,
             image_size_bytes, checkpoint_id, officer_id, sync_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, scan_id, traveler_name, document_number, scanned_at
        """, (
            scan_data.get('scan_id'),
            scan_data.get('traveler_name'),
            scan_data.get('nationality'),
            str(scan_data.get('date_of_birth')) if scan_data.get('date_of_birth') else None,
            scan_data.get('sex'),
            scan_data.get('document_number'),
            scan_data.get('document_type'),
            str(scan_data.get('expiry_date')) if scan_data.get('expiry_date') else None,
            str(scan_data.get('issue_date')) if scan_data.get('issue_date') else None,
            scan_data.get('mrz_line_1'),
            scan_data.get('mrz_line_2'),
            image_bytes,
            'image/jpeg' if image_bytes else None,
            len(image_bytes) if image_bytes else None,
            scan_data.get('checkpoint_id', 'CP-04-NORTH'),
            scan_data.get('officer_id', 'SSB-7489-N'),
            scan_data.get('sync_status', 'LOCAL_PENDING'),
        ))
        result = cur.fetchone()

        # Also log to audit
        cur.execute("""
            INSERT INTO audit_log (action_type, scan_id, officer_id, details)
            VALUES ('SCAN', ?, ?, ?)
        """, (
            scan_data.get('scan_id'),
            scan_data.get('officer_id', 'SSB-7489-N'),
            json.dumps({"document_type": scan_data.get('document_type'), "nationality": scan_data.get('nationality')}),
        ))

        return dict(result) if result else {}


def insert_scan_record(data: dict) -> dict:
    """
    Insert or update a scan record in the local scans table.
    Columns: record_id, checkpoint_id, officer_id, timestamp, image_path, document_type, status
    """
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO scans 
            (record_id, checkpoint_id, officer_id, timestamp, image_path, document_type, status)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (record_id) DO UPDATE SET
                checkpoint_id = excluded.checkpoint_id,
                officer_id = excluded.officer_id,
                timestamp = excluded.timestamp,
                image_path = excluded.image_path,
                document_type = excluded.document_type,
                status = excluded.status
            RETURNING *
        """, (
            data.get('record_id'),
            data.get('checkpoint_id', 'CP-04-NORTH'),
            data.get('officer_id', 'SSB-OFFICER'),
            data.get('timestamp', datetime.now().isoformat()),
            data.get('image_path'),
            data.get('document_type', 'passport'),
            data.get('status', 'captured')
        ))
        row = cur.fetchone()
        return dict(row) if row else {}


def get_scan_record(record_id: str) -> dict | None:
    """Get a scan record from the local scans table."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM scans WHERE record_id = ?", (record_id,))
        row = cur.fetchone()
        return dict(row) if row else None


def insert_extracted_fields(data: dict) -> dict:
    """
    Insert or update extracted fields for a scan record.
    Generic across passport, national_id, and visa.
    Columns: record_id, document_type, name, date_of_birth, document_number,
             nationality, gender, issue_date, expiry_date, mrz_raw, extra_fields
    """
    with get_db() as conn:
        cur = conn.cursor()
        rec_id = data.get('record_id')
        doc_type = data.get('document_type', 'passport')
        
        # Ensure parent row exists in scans table to satisfy foreign key constraint
        if rec_id:
            cur.execute("""
                INSERT INTO scans (record_id, checkpoint_id, officer_id, timestamp, document_type, status)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (record_id) DO UPDATE SET document_type = excluded.document_type
            """, (
                rec_id,
                data.get('checkpoint_id', 'CP-04-NORTH'),
                data.get('officer_id', 'SSB-OFFICER'),
                datetime.now().isoformat(),
                doc_type,
                'captured'
            ))

        extra_fields_val = data.get('extra_fields')
        if isinstance(extra_fields_val, (dict, list)):
            extra_fields_val = json.dumps(extra_fields_val)

        cur.execute("""
            INSERT INTO extracted_fields 
            (record_id, document_type, name, date_of_birth, document_number,
             nationality, gender, issue_date, expiry_date, mrz_raw, extra_fields)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (record_id) DO UPDATE SET
                document_type = excluded.document_type,
                name = excluded.name,
                date_of_birth = excluded.date_of_birth,
                document_number = excluded.document_number,
                nationality = excluded.nationality,
                gender = excluded.gender,
                issue_date = excluded.issue_date,
                expiry_date = excluded.expiry_date,
                mrz_raw = excluded.mrz_raw,
                extra_fields = excluded.extra_fields
            RETURNING *
        """, (
            data.get('record_id'),
            data.get('document_type', 'passport'),
            data.get('name'),
            str(data.get('date_of_birth')) if data.get('date_of_birth') else None,
            data.get('document_number'),
            data.get('nationality'),
            data.get('gender'),
            str(data.get('issue_date')) if data.get('issue_date') else None,
            str(data.get('expiry_date')) if data.get('expiry_date') else None,
            data.get('mrz_raw'),
            extra_fields_val
        ))
        row = cur.fetchone()
        if not row:
            return {}
        d = dict(row)
        d['extra_fields'] = _parse_json_field(d.get('extra_fields'))
        return d


def get_extracted_fields(record_id: str) -> dict | None:
    """Get extracted fields for a scan record."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM extracted_fields WHERE record_id = ?", (record_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d['extra_fields'] = _parse_json_field(d.get('extra_fields'))
        return d


def insert_validation_results(data: dict) -> dict:
    """
    Insert or update validation results for a scan record.
    Columns: record_id, validation_passed, mrz_checksum_passed, field_format_passed,
             date_logic_passed, photo_validation_passed, failure_reasons
    """
    with get_db() as conn:
        cur = conn.cursor()
        rec_id = data.get('record_id')
        if not rec_id:
            return {}

        is_passed = data.get('validation_passed')
        if is_passed is None:
            is_passed = bool(
                data.get('mrz_checksum_passed', True) and
                data.get('field_format_passed', True) and
                data.get('date_logic_passed', True)
            )

        reasons = data.get('failure_reasons', [])
        if isinstance(reasons, (list, dict)):
            reasons = json.dumps(reasons)

        cur.execute("""
            INSERT INTO validation_results
            (record_id, validation_passed, mrz_checksum_passed, field_format_passed,
             date_logic_passed, photo_validation_passed, failure_reasons)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT (record_id) DO UPDATE SET
                validation_passed = excluded.validation_passed,
                mrz_checksum_passed = excluded.mrz_checksum_passed,
                field_format_passed = excluded.field_format_passed,
                date_logic_passed = excluded.date_logic_passed,
                photo_validation_passed = excluded.photo_validation_passed,
                failure_reasons = excluded.failure_reasons
            RETURNING *
        """, (
            rec_id,
            bool(is_passed),
            bool(data.get('mrz_checksum_passed', True)),
            bool(data.get('field_format_passed', True)),
            bool(data.get('date_logic_passed', True)),
            bool(data.get('photo_validation_passed', True)),
            reasons
        ))
        row = cur.fetchone()
        if not row:
            return {}
        d = dict(row)
        d['validation_passed'] = bool(d.get('validation_passed'))
        d['mrz_checksum_passed'] = bool(d.get('mrz_checksum_passed'))
        d['field_format_passed'] = bool(d.get('field_format_passed'))
        d['date_logic_passed'] = bool(d.get('date_logic_passed'))
        d['photo_validation_passed'] = bool(d.get('photo_validation_passed'))
        d['failure_reasons'] = _parse_json_field(d.get('failure_reasons'))
        return d


def get_validation_results(record_id: str) -> dict | None:
    """Get validation results for a scan record."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT * FROM validation_results WHERE record_id = ?", (record_id,))
        row = cur.fetchone()
        if not row:
            return None
        d = dict(row)
        d['validation_passed'] = bool(d.get('validation_passed'))
        d['mrz_checksum_passed'] = bool(d.get('mrz_checksum_passed'))
        d['field_format_passed'] = bool(d.get('field_format_passed'))
        d['date_logic_passed'] = bool(d.get('date_logic_passed'))
        d['photo_validation_passed'] = bool(d.get('photo_validation_passed'))
        d['failure_reasons'] = _parse_json_field(d.get('failure_reasons'))
        return d


def validate_scan_record(record_id: str, validation_data: dict = None) -> dict:
    """
    Step 5: Validates an 'ocr_done' (or any) scan record.
    Transitions status to 'validated' (if validation_passed) or 'validation_failed' (if failed).
    Stores validation_passed and failure_reasons. Never auto-denies.
    """
    validation_data = validation_data or {}
    validation_data['record_id'] = record_id

    # Store validation results
    res = insert_validation_results(validation_data)
    is_passed = bool(res.get('validation_passed', False))
    new_status = 'validated' if is_passed else 'validation_failed'

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE scans SET status = ? WHERE record_id = ?", (new_status, record_id))

    return {
        "record_id": record_id,
        "status": new_status,
        "validation_passed": is_passed,
        "failure_reasons": res.get('failure_reasons', []),
        "validation_results": res
    }


def insert_analysis(scan_id: str, analysis_data: dict) -> dict:
    """Insert pipeline analysis results for a scan."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO analysis_results
            (scan_id, risk_score, confidence, quality_gate, ocr_result,
             mrz_validation, field_consistency, chronology_logic,
             tamper_detection, face_match, injection_defense,
             anomalies, processing_time_ms)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            RETURNING id, scan_id, risk_score, confidence, analyzed_at
        """, (
            scan_id,
            analysis_data.get('risk_score', 0),
            analysis_data.get('confidence', 100),
            json.dumps(analysis_data.get('quality_gate')) if analysis_data.get('quality_gate') is not None else None,
            json.dumps(analysis_data.get('ocr_result')) if analysis_data.get('ocr_result') is not None else None,
            json.dumps(analysis_data.get('mrz_validation')) if analysis_data.get('mrz_validation') is not None else None,
            json.dumps(analysis_data.get('field_consistency')) if analysis_data.get('field_consistency') is not None else None,
            json.dumps(analysis_data.get('chronology_logic')) if analysis_data.get('chronology_logic') is not None else None,
            json.dumps(analysis_data.get('tamper_detection')) if analysis_data.get('tamper_detection') is not None else None,
            json.dumps(analysis_data.get('face_match')) if analysis_data.get('face_match') is not None else None,
            json.dumps(analysis_data.get('injection_defense')) if analysis_data.get('injection_defense') is not None else None,
            json.dumps(analysis_data.get('anomalies', [])),
            analysis_data.get('processing_time_ms'),
        ))
        result = cur.fetchone()
        return dict(result) if result else {}


def insert_decision(scan_id: str, decision_data: dict) -> dict:
    """Insert an officer decision (approve/deny/escalate/override)."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO decisions
            (scan_id, decision, officer_id, officer_notes, reasons,
             ledger_block_index, ledger_hash)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            RETURNING id, scan_id, decision, decided_at
        """, (
            scan_id,
            decision_data.get('decision'),
            decision_data.get('officer_id', 'SSB-7489-N'),
            decision_data.get('officer_notes'),
            json.dumps(decision_data.get('reasons', [])),
            decision_data.get('ledger_block_index'),
            decision_data.get('ledger_hash'),
        ))
        result = cur.fetchone()

        # Audit log
        cur.execute("""
            INSERT INTO audit_log (action_type, scan_id, officer_id, details)
            VALUES (?, ?, ?, ?)
        """, (
            decision_data.get('decision', 'DECISION'),
            scan_id,
            decision_data.get('officer_id', 'SSB-7489-N'),
            json.dumps({"notes": decision_data.get('officer_notes'), "risk_score": decision_data.get('risk_score')}),
        ))

        return dict(result) if result else {}


def get_all_scans(limit: int = 50, offset: int = 0) -> list:
    """Get all scanned documents (without binary image data for performance)."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT sd.id, sd.scan_id, sd.traveler_name, sd.nationality,
                   sd.date_of_birth, sd.sex, sd.document_number, sd.document_type,
                   sd.expiry_date, sd.image_size_bytes, sd.checkpoint_id,
                   sd.officer_id, sd.scanned_at, sd.sync_status,
                   ar.risk_score, ar.confidence, ar.anomalies,
                   d.decision, d.officer_notes, d.decided_at
            FROM scanned_documents sd
            LEFT JOIN analysis_results ar ON sd.scan_id = ar.scan_id
            LEFT JOIN decisions d ON sd.scan_id = d.scan_id
            ORDER BY sd.scanned_at DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        
        rows = []
        for r in cur.fetchall():
            item = dict(r)
            item['anomalies'] = _parse_json_field(item.get('anomalies'))
            rows.append(item)
        return rows


def get_scan_image(scan_id: str) -> tuple | None:
    """Get the JPEG image for a specific scan."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT document_image, image_mime_type
            FROM scanned_documents
            WHERE scan_id = ? AND document_image IS NOT NULL
        """, (scan_id,))
        row = cur.fetchone()
        if row:
            return row['document_image'], row['image_mime_type']
        return None


def get_scan_detail(scan_id: str) -> dict | None:
    """Get full scan details including analysis and decision."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT sd.*, ar.risk_score, ar.confidence, ar.anomalies,
                   ar.quality_gate, ar.ocr_result, ar.mrz_validation,
                   ar.field_consistency, ar.chronology_logic,
                   ar.tamper_detection, ar.face_match, ar.injection_defense,
                   ar.processing_time_ms,
                   d.decision, d.officer_notes, d.reasons as decision_reasons,
                   d.ledger_block_index, d.ledger_hash, d.decided_at
            FROM scanned_documents sd
            LEFT JOIN analysis_results ar ON sd.scan_id = ar.scan_id
            LEFT JOIN decisions d ON sd.scan_id = d.scan_id
            WHERE sd.scan_id = ?
        """, (scan_id,))
        row = cur.fetchone()
        if row:
            result = dict(row)
            # Remove raw binary image from detail JSON response
            result.pop('document_image', None)
            
            # Parse JSON fields
            for key in ['anomalies', 'quality_gate', 'ocr_result', 'mrz_validation',
                        'field_consistency', 'chronology_logic', 'tamper_detection',
                        'face_match', 'injection_defense', 'decision_reasons']:
                if key in result:
                    result[key] = _parse_json_field(result[key])

            # Attach extracted_fields if present
            cur.execute("SELECT * FROM extracted_fields WHERE record_id = ?", (scan_id,))
            ef_row = cur.fetchone()
            if ef_row:
                ef = dict(ef_row)
                ef['extra_fields'] = _parse_json_field(ef.get('extra_fields'))
                result['extracted_fields'] = ef

            return result
        return None


def get_audit_log(limit: int = 100) -> list:
    """Get recent audit log entries."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT * FROM audit_log
            ORDER BY timestamp DESC
            LIMIT ?
        """, (limit,))
        
        rows = []
        for r in cur.fetchall():
            item = dict(r)
            item['details'] = _parse_json_field(item.get('details'))
            rows.append(item)
        return rows


def get_dashboard_stats() -> dict:
    """Get aggregate dashboard statistics."""
    with get_db() as conn:
        cur = conn.cursor()

        # Total scans today
        cur.execute("""
            SELECT COUNT(*) as total FROM scanned_documents
            WHERE DATE(scanned_at) = DATE('now')
        """)
        today_scans = cur.fetchone()['total']

        # Total scans all time
        cur.execute("SELECT COUNT(*) as total FROM scanned_documents")
        all_scans = cur.fetchone()['total']

        # Decision breakdown
        cur.execute("""
            SELECT decision, COUNT(*) as count
            FROM decisions
            WHERE decision IS NOT NULL
            GROUP BY decision
        """)
        decisions = {row['decision']: row['count'] for row in cur.fetchall()}

        # Average risk score
        cur.execute("SELECT COALESCE(AVG(risk_score), 0) as avg_risk FROM analysis_results")
        avg_risk = round(cur.fetchone()['avg_risk'], 1)

        # High risk count (>50)
        cur.execute("SELECT COUNT(*) as count FROM analysis_results WHERE risk_score > 50")
        high_risk = cur.fetchone()['count']

        return {
            "today_scans": today_scans,
            "total_scans": all_scans,
            "decisions": decisions,
            "avg_risk_score": avg_risk,
            "high_risk_count": high_risk,
        }


# ============================================================
# AUTHENTICATION & OFFICER MANAGEMENT
# ============================================================

def verify_officer(officer_id: str, password: str):
    """Verify officer credentials."""
    import hashlib
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, officer_id, full_name, rank, checkpoint_id, badge_number, status, created_at
            FROM officers
            WHERE UPPER(officer_id) = UPPER(?) AND password_hash = ?
        """, (officer_id.strip(), pw_hash))
        row = cur.fetchone()
        return dict(row) if row else None


def verify_admin(admin_id: str, password: str):
    """Verify administrator credentials."""
    import hashlib
    pw_hash = hashlib.sha256(password.encode()).hexdigest()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT id, admin_id, full_name, role, created_at
            FROM admins
            WHERE UPPER(admin_id) = UPPER(?) AND password_hash = ?
        """, (admin_id.strip(), pw_hash))
        row = cur.fetchone()
        return dict(row) if row else None


def get_all_officers():
    """Return all registered officers (excluding password hash)."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT officer_id, full_name, rank, checkpoint_id, badge_number, status, created_at
            FROM officers
            ORDER BY created_at DESC
        """)
        return [dict(r) for r in cur.fetchall()]


def insert_officer(officer_data: dict):
    """Admin provisions a new officer in the database."""
    import hashlib
    pw = officer_data.get("password", "")
    pw_hash = hashlib.sha256(pw.encode()).hexdigest() if pw else ""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO officers (officer_id, full_name, rank, checkpoint_id, badge_number, password_hash, status)
            VALUES (?, ?, ?, ?, ?, ?, 'ACTIVE')
        """, (
            officer_data.get("officer_id", "").strip().upper(),
            officer_data.get("full_name", "").strip(),
            officer_data.get("rank", "Sub-Inspector"),
            officer_data.get("checkpoint_id", "CP-04-NORTH"),
            officer_data.get("badge_number", "SSB-REG"),
            pw_hash
        ))
        return {
            "officer_id": officer_data.get("officer_id", "").strip().upper(),
            "full_name": officer_data.get("full_name", "").strip(),
            "rank": officer_data.get("rank", "Sub-Inspector"),
            "checkpoint_id": officer_data.get("checkpoint_id", "CP-04-NORTH"),
            "badge_number": officer_data.get("badge_number", "SSB-REG"),
            "status": "ACTIVE"
        }


def toggle_officer_status(officer_id: str):
    """Toggle officer active/suspended status."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT status FROM officers WHERE UPPER(officer_id) = UPPER(?)", (officer_id.strip(),))
        row = cur.fetchone()
        if not row:
            return None
        new_status = "SUSPENDED" if row["status"] == "ACTIVE" else "ACTIVE"
        cur.execute("UPDATE officers SET status = ? WHERE UPPER(officer_id) = UPPER(?)", (new_status, officer_id.strip()))
        return {"officer_id": officer_id, "status": new_status}


def reset_officer_password(officer_id: str, new_password: str):
    """Admin resets an officer's terminal PIN/password."""
    import hashlib
    pw_hash = hashlib.sha256(new_password.encode()).hexdigest()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("UPDATE officers SET password_hash = ? WHERE UPPER(officer_id) = UPPER(?)", (pw_hash, officer_id.strip()))
        return {"officer_id": officer_id, "success": cur.rowcount > 0}


def delete_officer(officer_id: str):
    """Decommission and remove an officer from the database."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM officers WHERE UPPER(officer_id) = UPPER(?)", (officer_id.strip(),))
        return {"officer_id": officer_id, "deleted": cur.rowcount > 0}


def update_officer(officer_id: str, updates: dict):
    """Update officer rank, checkpoint, or badge details."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            UPDATE officers
            SET full_name = COALESCE(?, full_name),
                rank = COALESCE(?, rank),
                checkpoint_id = COALESCE(?, checkpoint_id),
                badge_number = COALESCE(?, badge_number)
            WHERE UPPER(officer_id) = UPPER(?)
        """, (
            updates.get("full_name"),
            updates.get("rank"),
            updates.get("checkpoint_id"),
            updates.get("badge_number"),
            officer_id.strip()
        ))
        return {"officer_id": officer_id, "updated": cur.rowcount > 0}


# ============================================================
# User Sessions (Token-Based Role Auth)
# ============================================================

def create_user_session(user_id: str, role: str, checkpoint_id: str | None = None) -> str:
    """Generate and store a new active session token."""
    import secrets
    token = f"dcu_{secrets.token_hex(24)}"
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO user_sessions (token, user_id, role, checkpoint_id)
            VALUES (?, ?, ?, ?)
        """, (token, user_id, role, checkpoint_id))
    return token


def get_user_session(token: str) -> dict | None:
    """Retrieve session details by token."""
    if not token:
        return None
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT token, user_id, role, checkpoint_id, created_at
            FROM user_sessions
            WHERE token = ?
        """, (token.strip(),))
        row = cur.fetchone()
        return dict(row) if row else None


def delete_user_session(token: str) -> bool:
    """Invalidate a session token."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("DELETE FROM user_sessions WHERE token = ?", (token,))
        return cur.rowcount > 0


# ============================================================
# Checkpoint Management
# ============================================================

def get_all_checkpoints() -> list:
    """List all registered border checkpoints."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT checkpoint_id, name, sector, location, status, registered_at
            FROM checkpoints
            ORDER BY checkpoint_id ASC
        """)
        return [dict(r) for r in cur.fetchall()]


def create_checkpoint(checkpoint_data: dict) -> dict:
    """Register a new border checkpoint."""
    cid = checkpoint_data.get("checkpoint_id", "").strip().upper()
    name = checkpoint_data.get("name", "").strip()
    sector = checkpoint_data.get("sector", "").strip()
    location = checkpoint_data.get("location", "").strip()
    status = checkpoint_data.get("status", "ACTIVE").strip().upper()

    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            INSERT INTO checkpoints (checkpoint_id, name, sector, location, status)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (checkpoint_id) DO UPDATE SET
                name = excluded.name,
                sector = excluded.sector,
                location = excluded.location,
                status = excluded.status
        """, (cid, name, sector, location, status))
        return {
            "checkpoint_id": cid,
            "name": name,
            "sector": sector,
            "location": location,
            "status": status
        }


# ============================================================
# Frequent-Crosser Central Ledger
# ============================================================

def lookup_central_ledger(document_id: str) -> dict:
    """
    Lookup a document in the central ledger across all border checkpoints.
    Returns status ('approved' | 'flagged' | 'unknown') and crossing_count.
    """
    normalized_id = (document_id or "").strip().upper()
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT document_id, status, crossing_count, last_checkpoint_id,
                   last_crossing_timestamp, flagged_reason
            FROM document_ledger
            WHERE UPPER(document_id) = ?
        """, (normalized_id,))
        doc_row = cur.fetchone()
        if doc_row:
            rec = dict(doc_row)
            return {
                "document_id": rec["document_id"],
                "status": rec["status"],
                "crossing_count": rec["crossing_count"],
                "last_checkpoint_id": rec.get("last_checkpoint_id"),
                "last_crossing": rec.get("last_crossing_timestamp"),
                "last_crossing_timestamp": rec.get("last_crossing_timestamp"),
                "flagged_reason": rec.get("flagged_reason")
            }

        cur.execute("""
            SELECT document_id, traveler_name, nationality, status, crossing_count,
                   last_crossing, last_checkpoint_id, last_officer_id
            FROM central_ledger
            WHERE UPPER(document_id) = ?
        """, (normalized_id,))
        row = cur.fetchone()
        if row:
            rec = dict(row)
            return {
                "document_id": rec["document_id"],
                "status": rec["status"],
                "crossing_count": rec["crossing_count"],
                "traveler_name": rec.get("traveler_name"),
                "nationality": rec.get("nationality"),
                "last_crossing": rec.get("last_crossing"),
                "last_checkpoint_id": rec.get("last_checkpoint_id")
            }
        else:
            return {
                "document_id": normalized_id,
                "status": "unknown",
                "crossing_count": 0,
                "traveler_name": None,
                "nationality": None,
                "last_crossing": None,
                "last_checkpoint_id": None,
                "flagged_reason": None
            }


def update_central_ledger(data: dict) -> dict:
    """
    Called after every finalized decision to update status and increment crossing count.
    """
    doc_id = (data.get("document_id") or data.get("docId") or "").strip().upper()
    if not doc_id:
        raise ValueError("document_id is required")

    decision = (data.get("decision") or data.get("status") or "approved").strip()
    checkpoint_id = data.get("checkpoint_id") or "CP-04-NORTH"
    officer_id = data.get("officer_id") or "SSB-7489-N"
    traveler_name = data.get("traveler_name")
    nationality = data.get("nationality")

    # Map decision string to canonical ledger status: approved / flagged
    norm_status = "approved" if "APPROV" in decision.upper() or "CLEAR" in decision.upper() else "flagged"

    with get_db() as conn:
        cur = conn.cursor()
        # Check existing
        cur.execute("SELECT crossing_count FROM central_ledger WHERE UPPER(document_id) = ?", (doc_id,))
        row = cur.fetchone()
        if row:
            new_count = (row["crossing_count"] or 0) + 1
            cur.execute("""
                UPDATE central_ledger
                SET status = ?,
                    crossing_count = ?,
                    last_checkpoint_id = ?,
                    last_officer_id = ?,
                    traveler_name = COALESCE(?, traveler_name),
                    nationality = COALESCE(?, nationality),
                    last_crossing = CURRENT_TIMESTAMP,
                    updated_at = CURRENT_TIMESTAMP
                WHERE UPPER(document_id) = ?
            """, (norm_status, new_count, checkpoint_id, officer_id, traveler_name, nationality, doc_id))
        else:
            new_count = 1
            cur.execute("""
                INSERT INTO central_ledger
                (document_id, traveler_name, nationality, status, crossing_count,
                 last_checkpoint_id, last_officer_id, last_crossing)
                VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            """, (doc_id, traveler_name, nationality, norm_status, new_count, checkpoint_id, officer_id))

        flagged_reason = data.get("flagged_reason") or (None if norm_status == "approved" else "Flagged during checkpoint inspection")
        cur.execute("""
            INSERT INTO document_ledger (document_id, status, crossing_count, last_checkpoint_id, last_crossing_timestamp, flagged_reason)
            VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
            ON CONFLICT (document_id) DO UPDATE SET
                status = excluded.status,
                crossing_count = excluded.crossing_count,
                last_checkpoint_id = excluded.last_checkpoint_id,
                last_crossing_timestamp = CURRENT_TIMESTAMP,
                flagged_reason = COALESCE(excluded.flagged_reason, document_ledger.flagged_reason)
        """, (doc_id, norm_status, new_count, checkpoint_id, flagged_reason))

        return {
            "document_id": doc_id,
            "status": norm_status,
            "crossing_count": new_count,
            "last_checkpoint_id": checkpoint_id,
            "last_officer_id": officer_id,
            "flagged_reason": flagged_reason
        }


# ============================================================
# Central Audit Log Sync & Tamper-Evident Verification
# ============================================================

def compute_canonical_entry_hash(entry: dict) -> str:
    """
    Computes SHA-256 hash incorporating prior_hash to verify block integrity.
    Compatible with client-side hashChain.js format.
    """
    import hashlib
    # Format 1: hashChain.js canonical string
    idx = entry.get("index", 0)
    prev = str(entry.get("prior_hash") or entry.get("prevHash") or "")
    ts = str(entry.get("timestamp") or "")
    doc_id = str(entry.get("record_id") or entry.get("docId") or "")
    off_id = str(entry.get("officer_id") or entry.get("officerId") or "")
    risk = str(entry.get("risk_score") if entry.get("risk_score") is not None else entry.get("riskScore", 0))
    dec = str(entry.get("decision") or "")
    trav = str(entry.get("traveler_name") or entry.get("travelerName") or "")
    nat = str(entry.get("nationality") or "")
    path = str(entry.get("pathway") or "FULL_PIPELINE")

    canon1 = f"{idx}|{prev}|{ts}|{doc_id}|{off_id}|{risk}|{dec}|{trav}|{nat}|{path}"
    h1 = hashlib.sha256(canon1.encode('utf-8')).hexdigest()

    # Format 2: standard sync format
    canon2 = f"{doc_id}|{prev}|{ts}|{risk}|{dec}|{off_id}"
    h2 = hashlib.sha256(canon2.encode('utf-8')).hexdigest()

    # Format 3: simple pair
    canon3 = f"{prev}:{doc_id}:{dec}:{ts}"
    h3 = hashlib.sha256(canon3.encode('utf-8')).hexdigest()

    return (h1, h2, h3)


def verify_and_insert_audit_sync(entries: list) -> dict:
    """
    Accepts batch of audit entries.
    1. Verifies no document images are attached (lightweight sync rule).
    2. Verifies entry_hash correctly incorporates prior_hash.
    3. Rejects any entry failing verification (indicates local tampering).
    4. Inserts verified entries into sync_audit_log.
    """
    if not isinstance(entries, list) or len(entries) == 0:
        raise ValueError("Batch must contain at least one audit entry")

    accepted_records = []

    for i, entry in enumerate(entries):
        if not isinstance(entry, dict):
            raise ValueError(f"Entry {i} must be a dictionary object")

        # 1. Reject document image data centrally
        forbidden_image_keys = ("document_image", "image_base64", "photo", "image", "raw_image")
        for k in forbidden_image_keys:
            if k in entry and entry[k]:
                raise ValueError(
                    f"Entry {i} contains central image data ('{k}'). Central sync accepts only metadata and decision records."
                )

        record_id = entry.get("record_id") or entry.get("docId") or entry.get("id")
        checkpoint_id = entry.get("checkpoint_id") or entry.get("checkpointId")
        officer_id = entry.get("officer_id") or entry.get("officerId")
        timestamp = entry.get("timestamp")
        prior_hash = entry.get("prior_hash") or entry.get("prevHash")
        entry_hash = entry.get("entry_hash") or entry.get("hash")
        decision = entry.get("decision")
        risk_score = entry.get("risk_score") if entry.get("risk_score") is not None else entry.get("riskScore", 0)

        # Required fields check
        if not record_id or not checkpoint_id or not officer_id or not timestamp:
            raise ValueError(f"Entry {i} missing required identifiers (record_id, checkpoint_id, officer_id, timestamp)")
        if not prior_hash or not entry_hash or not decision:
            raise ValueError(f"Entry {i} missing required cryptographic fields (prior_hash, entry_hash, decision)")

        # Validate hex length for SHA-256 (64 hex characters)
        if len(str(entry_hash).strip()) != 64 or len(str(prior_hash).strip()) != 64:
            raise ValueError(f"Entry {i} contains malformed hash (must be 64-char hex SHA-256)")

        # 2. Verify entry_hash incorporates prior_hash
        clean_entry_hash = str(entry_hash).strip().lower()
        clean_prior_hash = str(prior_hash).strip().lower()

        valid_hashes = [h.lower() for h in compute_canonical_entry_hash(entry)]

        # Check if entry_hash matches any valid canonical calculation
        if clean_entry_hash not in valid_hashes:
            # Check if entry hash is a known client-side hash that incorporated prior_hash
            # Or if it fails hash verification completely
            import hashlib
            raw_check = hashlib.sha256(f"{clean_prior_hash}:{record_id}".encode()).hexdigest()
            if clean_entry_hash != raw_check:
                raise ValueError(
                    f"Entry {i} (record_id: {record_id}) FAILED hash verification. "
                    f"entry_hash does not incorporate prior_hash. Local log may be tampered or corrupted."
                )

        accepted_records.append({
            "record_id": str(record_id).strip(),
            "checkpoint_id": str(checkpoint_id).strip().upper(),
            "officer_id": str(officer_id).strip().upper(),
            "timestamp": str(timestamp).strip(),
            "risk_score": int(risk_score) if str(risk_score).isdigit() else 0,
            "decision": str(decision).strip(),
            "prior_hash": clean_prior_hash,
            "entry_hash": clean_entry_hash,
            "traveler_name": entry.get("traveler_name") or entry.get("travelerName"),
            "nationality": entry.get("nationality"),
            "pathway": entry.get("pathway", "FULL_PIPELINE")
        })

    # 3. Store accepted records
    inserted_count = 0
    with get_db() as conn:
        cur = conn.cursor()
        for rec in accepted_records:
            cur.execute("""
                INSERT INTO sync_audit_log 
                (record_id, checkpoint_id, officer_id, timestamp, risk_score,
                 decision, prior_hash, entry_hash, traveler_name, nationality,
                 pathway, verification_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'VERIFIED')
                ON CONFLICT (record_id) DO UPDATE SET
                    verification_status = 'VERIFIED'
            """, (
                rec["record_id"],
                rec["checkpoint_id"],
                rec["officer_id"],
                rec["timestamp"],
                rec["risk_score"],
                rec["decision"],
                rec["prior_hash"],
                rec["entry_hash"],
                rec["traveler_name"],
                rec["nationality"],
                rec["pathway"]
            ))

            cur.execute("""
                INSERT INTO audit_log
                (record_id, timestamp, officer_id, checkpoint_id, risk_score, decision, prior_hash, entry_hash)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                rec["record_id"],
                rec["timestamp"],
                rec["officer_id"],
                rec["checkpoint_id"],
                rec["risk_score"],
                rec["decision"],
                rec["prior_hash"],
                rec["entry_hash"]
            ))
            inserted_count += 1

    return {
        "status": "success",
        "processed_count": inserted_count,
        "verified": True,
        "message": f"Successfully verified and synced {inserted_count} audit records"
    }


def get_checkpoint_audit_log(checkpoint_id: str, limit: int = 100, offset: int = 0) -> list:
    """Return audit records for a single checkpoint (officer access)."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT entry_id, record_id, checkpoint_id, officer_id, timestamp, risk_score,
                   decision, prior_hash, entry_hash, received_at
            FROM audit_log
            WHERE UPPER(checkpoint_id) = UPPER(?)
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (checkpoint_id.strip(), limit, offset))
        rows = [dict(r) for r in cur.fetchall()]
        if rows:
            return rows

        cur.execute("""
            SELECT record_id, checkpoint_id, officer_id, timestamp, risk_score,
                   decision, prior_hash, entry_hash, traveler_name, nationality,
                   pathway, verification_status, synced_at AS received_at
            FROM sync_audit_log
            WHERE UPPER(checkpoint_id) = UPPER(?)
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (checkpoint_id.strip(), limit, offset))
        return [dict(r) for r in cur.fetchall()]


def get_all_sync_audit_log(limit: int = 200, offset: int = 0) -> list:
    """Return all audit records across all checkpoints (admin access only)."""
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("""
            SELECT entry_id, record_id, checkpoint_id, officer_id, timestamp, risk_score,
                   decision, prior_hash, entry_hash, received_at
            FROM audit_log
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        rows = [dict(r) for r in cur.fetchall()]
        if rows:
            return rows

        cur.execute("""
            SELECT record_id, checkpoint_id, officer_id, timestamp, risk_score,
                   decision, prior_hash, entry_hash, traveler_name, nationality,
                   pathway, verification_status, synced_at AS received_at
            FROM sync_audit_log
            ORDER BY timestamp DESC
            LIMIT ? OFFSET ?
        """, (limit, offset))
        return [dict(r) for r in cur.fetchall()]


