"""Notification settings — DB-backed with env var fallback.

Settings are stored as a JSON blob in the system_state table under the key
'notification_settings'. Any field not present in the DB row falls back to
the corresponding env var value from config.py.
"""
import json
import math
import logging
import re

from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemState

logger = logging.getLogger(__name__)

SETTINGS_KEY = "notification_settings"

_FIELDS = [
    "telegram_bot_token",
    "telegram_chat_id",
    "notification_email_to",
    "notification_email_from",
    "smtp_host",
    "smtp_port",
    "smtp_user",
    "smtp_password",
    "smtp_use_tls",
    "notification_frequency",
    "health_check_notifications_enabled",
    "inference_provider",
    "fireworks_api_key",
    "fireworks_audio_base_url",
    "fireworks_stt_model",
    "fireworks_stt_diarize",
    "fireworks_chat_base_url",
    "fireworks_chat_model",
    "fireworks_stt_cost_per_minute_usd",
    "embedding_provider",
    "embedding_model",
    "fireworks_embedding_base_url",
    "fireworks_embedding_model",
]

_SENSITIVE_FIELDS = {"telegram_bot_token", "smtp_password", "fireworks_api_key"}

_NULLABLE_FIELDS = {
    "telegram_bot_token",
    "telegram_chat_id",
    "notification_email_to",
    "smtp_user",
    "smtp_password",
    "fireworks_api_key",
}

_VALID_FREQUENCIES = {"immediate", "daily", "weekly"}
_VALID_INFERENCE_PROVIDERS = {"local", "fireworks"}
_VALID_EMBEDDING_PROVIDERS = {"local", "fireworks"}
_INFERENCE_FIELDS = {
    "inference_provider",
    "fireworks_api_key",
    "fireworks_audio_base_url",
    "fireworks_stt_model",
    "fireworks_stt_diarize",
    "fireworks_chat_base_url",
    "fireworks_chat_model",
    "fireworks_stt_cost_per_minute_usd",
}
_EMBEDDING_FIELDS = {
    "embedding_provider",
    "embedding_model",
    "fireworks_api_key",
    "fireworks_embedding_base_url",
    "fireworks_embedding_model",
}

_EMAIL_RE = re.compile(r"^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$")


def _env_defaults() -> dict:
    """Read current env var defaults from the settings singleton."""
    return {field: getattr(settings, field) for field in _FIELDS}


def _read_db_settings(db: Session) -> dict | None:
    """Read the notification_settings JSON blob from system_state. Returns None if not found."""
    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    if row is None:
        return None
    try:
        return json.loads(row.value)
    except Exception:
        return None


def get_notification_settings(db: Session) -> dict:
    """Read notification settings, merging DB values over env var defaults.

    Returns the full settings dict plus telegram_configured and email_configured booleans.
    """
    merged = _env_defaults()
    db_settings = _read_db_settings(db)
    if db_settings is not None:
        for key, value in db_settings.items():
            if key in merged and value is not None and value != "":
                merged[key] = value

    merged["telegram_configured"] = (
        merged.get("telegram_bot_token") is not None
        and merged.get("telegram_chat_id") is not None
    )
    merged["email_configured"] = bool(merged.get("notification_email_to"))
    merged["fireworks_configured"] = bool(merged.get("fireworks_api_key"))
    return merged


def save_notification_settings(db: Session, updates: dict) -> dict:
    """Validate and merge partial updates into stored settings. Returns the full merged result.

    Raises ValueError for invalid values.
    """
    if "notification_frequency" in updates:
        if updates["notification_frequency"] not in _VALID_FREQUENCIES:
            raise ValueError(
                f"notification_frequency must be one of {_VALID_FREQUENCIES}, "
                f"got '{updates['notification_frequency']}'"
            )
    if "smtp_port" in updates:
        port = updates["smtp_port"]
        if not isinstance(port, int) or port < 1 or port > 65535:
            raise ValueError(f"smtp_port must be a positive integer (1-65535), got {port!r}")
    if "inference_provider" in updates:
        if updates["inference_provider"] not in _VALID_INFERENCE_PROVIDERS:
            raise ValueError(
                f"inference_provider must be one of {_VALID_INFERENCE_PROVIDERS}, "
                f"got '{updates['inference_provider']}'"
            )
    if "embedding_provider" in updates:
        if updates["embedding_provider"] not in _VALID_EMBEDDING_PROVIDERS:
            raise ValueError(
                f"embedding_provider must be one of {_VALID_EMBEDDING_PROVIDERS}, "
                f"got '{updates['embedding_provider']}'"
            )
    if "fireworks_stt_cost_per_minute_usd" in updates:
        rate = updates["fireworks_stt_cost_per_minute_usd"]
        if (
            not isinstance(rate, (int, float))
            or not math.isfinite(float(rate))
            or float(rate) < 0
        ):
            raise ValueError(
                "fireworks_stt_cost_per_minute_usd must be a non-negative number"
            )
        updates["fireworks_stt_cost_per_minute_usd"] = float(rate)

    # Normalize empty/whitespace strings to None for nullable fields
    for key in list(updates.keys()):
        if key in _NULLABLE_FIELDS and isinstance(updates[key], str) and not updates[key].strip():
            updates[key] = None

    if "notification_email_to" in updates and updates["notification_email_to"] is not None:
        emails = [e.strip() for e in updates["notification_email_to"].split(",") if e.strip()]
        if not emails:
            updates["notification_email_to"] = None
        else:
            for email in emails:
                if not _EMAIL_RE.match(email):
                    raise ValueError(
                        f"notification_email_to contains invalid email address: '{email}'"
                    )
            updates["notification_email_to"] = ", ".join(emails)

    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    if row is not None:
        existing = json.loads(row.value)
    else:
        existing = {}

    for key, value in updates.items():
        if key in _FIELDS:
            existing[key] = value

    new_value = json.dumps(existing)
    if row is not None:
        row.value = new_value
    else:
        new_row = SystemState(key=SETTINGS_KEY, value=new_value)
        db.add(new_row)
    db.commit()

    logger.info('"action": "notification_settings_saved", "keys": %s', list(updates.keys()))

    # Build the merged result directly from what was just persisted, rather than
    # re-querying the DB (which may return stale mock data in tests or a closed session).
    merged = _env_defaults()
    for key, value in existing.items():
        if key in merged and value is not None and value != "":
            merged[key] = value
    merged["telegram_configured"] = (
        merged.get("telegram_bot_token") is not None
        and merged.get("telegram_chat_id") is not None
    )
    merged["email_configured"] = bool(merged.get("notification_email_to"))
    merged["fireworks_configured"] = bool(merged.get("fireworks_api_key"))
    return merged


def mask_sensitive(settings_dict: dict) -> dict:
    """Return a copy with sensitive fields masked. None values stay None."""
    result = dict(settings_dict)
    for field in _SENSITIVE_FIELDS:
        value = result.get(field)
        if value is not None and isinstance(value, str) and len(value) > 6:
            result[field] = value[:3] + "***" + value[-3:]
        elif value is not None and isinstance(value, str):
            result[field] = "***"
    return result


def get_runtime_inference_settings(db: Session | None = None) -> dict:
    """Resolve inference settings for task execution (DB overrides env vars)."""
    if db is None:
        base = _env_defaults()
    else:
        base = get_notification_settings(db)
    return {key: base.get(key) for key in _INFERENCE_FIELDS}


def get_runtime_embedding_settings(db: Session | None = None) -> dict:
    """Resolve embedding settings for task/query embedding execution."""
    if db is None:
        base = _env_defaults()
    else:
        base = get_notification_settings(db)
    return {key: base.get(key) for key in _EMBEDDING_FIELDS}
