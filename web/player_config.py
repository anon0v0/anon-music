"""Anon Music runtime configuration. Secrets come from the service environment."""
import os


def env_bool(name: str, default: bool = False) -> bool:
    value = os.environ.get(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}

SMTP = {
    "host": os.environ.get("SMTP_HOST", ""),
    "port": int(os.environ.get("SMTP_PORT", "587")),
    "starttls": env_bool("SMTP_STARTTLS", True),
    "user": os.environ.get("SMTP_USER", ""),
    "password": os.environ.get("SMTP_PASSWORD", ""),
    "from_name": os.environ.get("SMTP_FROM_NAME", "Anon Music"),
}
if not SMTP["host"] or not SMTP["user"] or not SMTP["password"]:
    SMTP = {}

SESSION_DAYS = int(os.environ.get("SESSION_DAYS", "30"))
CODE_TTL = int(os.environ.get("CODE_TTL", "600"))
CODE_RESEND_INTERVAL = int(os.environ.get("CODE_RESEND_INTERVAL", "60"))
