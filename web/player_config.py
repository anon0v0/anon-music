"""Anon Music runtime configuration. Secrets come from the service environment."""
import os

SMTP = {
    "host": os.environ.get("SMTP_HOST", ""),
    "port": int(os.environ.get("SMTP_PORT", "587")),
    "starttls": os.environ.get("SMTP_STARTTLS", "1") == "1",
    "user": os.environ.get("SMTP_USER", ""),
    "password": os.environ.get("SMTP_PASSWORD", ""),
    "from_name": os.environ.get("SMTP_FROM_NAME", "Anon Music"),
}
if not SMTP["host"] or not SMTP["user"] or not SMTP["password"]:
    SMTP = {}

SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
CODE_TTL = int(os.environ.get("CODE_TTL", "600"))
CODE_RESEND_INTERVAL = int(os.environ.get("CODE_RESEND_INTERVAL", "60"))
