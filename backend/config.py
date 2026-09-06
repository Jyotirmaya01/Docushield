"""
DocuShield Backend Configuration
Database connection settings and application constants.
"""
import os

# SQLite Database settings (embedded, zero-setup)
DB_PATH = os.getenv("DOCUSHIELD_DB_PATH", os.path.join(os.path.dirname(__file__), "docushield.db"))
DB_CONFIG = {"path": DB_PATH, "type": "sqlite"}


# Image storage settings
MAX_IMAGE_SIZE_MB = 10
JPEG_QUALITY = 85  # JPEG compression quality (0-100)

# Server settings
CORS_ORIGINS = ["*"]  # Allow all origins for hackathon demo
API_PREFIX = "/api"
