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

        # Seed default officer
        cur.execute("""
            INSERT INTO officers (officer_id, full_name, rank, checkpoint_id, badge_number, password_hash, status)
            VALUES ('SSB-7489-N', 'Inspector Rameshwar Singh', 'Inspector / Screening Lead', 'CP-04-NORTH', 'SSB-VET-441', ?, 'ACTIVE')
            ON CONFLICT (officer_id) DO UPDATE SET password_hash = excluded.password_hash
        """, (officer_pw_hash,))

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

        # Audit log table
        cur.execute("""
            CREATE TABLE IF NOT EXISTS audit_log (
                id                  INTEGER PRIMARY KEY AUTOINCREMENT,
                action_type         TEXT NOT NULL,
                scan_id             TEXT,
                officer_id          TEXT,
                details             TEXT,
                ip_address          TEXT,
                timestamp           TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        """)

        # Create indexes
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scanned_docs_officer ON scanned_documents(officer_id)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_scanned_docs_date ON scanned_documents(scanned_at DESC)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_analysis_risk ON analysis_results(risk_score)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_decisions_type ON decisions(decision)")
        cur.execute("CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_log(timestamp DESC)")

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

