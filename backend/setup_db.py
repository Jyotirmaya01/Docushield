"""
DocuShield Database Setup Script (SQLite Version)
Initializes the embedded SQLite database file, tables, indexes, and default officer.

Usage:
    python setup_db.py
"""
import sys
import os
import sqlite3

# Ensure UTF-8 output on Windows consoles
if sys.platform == "win32" and hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

sys.path.insert(0, os.path.dirname(__file__))
from config import DB_PATH
from database import init_database, get_db

def setup():
    print("=" * 60)
    print("  DocuShield - SQLite Embedded Database Setup")
    print("=" * 60)
    print(f"  Database File: {os.path.abspath(DB_PATH)}")
    print("  Engine:        SQLite 3 (Built-in, Zero-Setup)")
    print("=" * 60)
    
    print("\n[1/2] Creating tables and indexes...")
    init_database()
    
    print("\n[2/2] Verifying tables and default officer...")
    with get_db() as conn:
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [row['name'] for row in cur.fetchall() if not row['name'].startswith('sqlite_')]
        print(f"  [OK] Verified {len(tables)} tables: {', '.join(tables)}")
        
        cur.execute("SELECT officer_id, full_name, rank FROM officers WHERE officer_id = 'SSB-7489-N'")
        officer = cur.fetchone()
        if officer:
            print(f"  [OK] Default officer verified: {officer['full_name']} ({officer['officer_id']})")
        else:
            print("  [WARN] Officer record not found.")

    print("\n" + "=" * 60)
    print("  [OK] DATABASE SETUP COMPLETE!")
    print("=" * 60)
    print("\n  You can start the server immediately:")
    print("    cd backend")
    print("    python server.py")
    print("\n  API will be available at:")
    print("    http://localhost:8000/docs  (Interactive Swagger UI)")
    print("    http://localhost:8000/api/health")
    print("=" * 60)


if __name__ == "__main__":
    setup()
