"""Switch an upgraded install off remote inference (#1092).

Podlog is becoming fully self-hosted. Removing the remote code only fixes fresh
installs: an existing deployment keeps its choices in the
``notification_settings`` blob, which overrides env, so a stored
``inference_provider=fireworks`` would keep routing to a provider that no
longer exists. This runs once per process start, in both the worker and the
pipeline API, and is idempotent:

- stored remote provider values become ``local`` (written, not deleted, so a
  leftover ``INFERENCE_PROVIDER=fireworks`` in .env cannot take over again);
- stored API keys and other remote-only fields are deleted;
- an embedding model nobody chose is pinned to the one that built the corpus,
  because the Fireworks path embedded with ``BAAI/bge-small-en-v1.5`` while the
  local default is ``all-MiniLM-L6-v2``, and the provenance guard (#945) would
  otherwise fail every embed job;
- env vars that are going away are named in one warning.

Nothing here may block startup: every failure is logged and swallowed.
"""

from __future__ import annotations

import json
import logging

from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemState
from app.services import embed_provenance
from app.services.notification_settings import (
    SETTINGS_KEY,
    _VALID_EMBEDDING_MODELS,
    get_notification_settings,
)

logger = logging.getLogger(__name__)

# Provider field -> the remote value it may still hold.
REMOTE_PROVIDER_VALUES = {
    "inference_provider": "fireworks",
    "diarization_provider": "precision2",
    "rag_provider": "fireworks",
    "embedding_provider": "fireworks",
}

# Stored fields that only ever configured a remote provider.
REMOTE_ONLY_FIELDS = (
    "fireworks_api_key",
    "fireworks_audio_base_url",
    "fireworks_stt_model",
    "fireworks_stt_diarize",
    "fireworks_chat_base_url",
    "fireworks_chat_model",
    "fireworks_stt_cost_per_minute_usd",
    "fireworks_embedding_base_url",
    "fireworks_embedding_model",
    "pyannote_api_key",
    "pyannote_cloud_base_url",
    "pyannote_cloud_model",
    "pyannote_cloud_cost_per_second_usd",
)

# Settings fields whose env vars are removed by #1092.
RETIRED_ENV_FIELDS = (*REMOTE_PROVIDER_VALUES, *REMOTE_ONLY_FIELDS)


def retired_env_vars_set() -> list[str]:
    """Names of retired env vars that are still set (from the environment or .env)."""
    return sorted(f.upper() for f in RETIRED_ENV_FIELDS if f in settings.model_fields_set)


def _embedding_model_to_pin(db: Session, stored: dict) -> str | None:
    """The recorded corpus model, when no embedding model was ever chosen."""
    if stored.get("embedding_model") or "embedding_model" in settings.model_fields_set:
        return None
    state = embed_provenance.read_state(db)
    recorded = state.get("model") if state else None
    if recorded not in _VALID_EMBEDDING_MODELS or recorded == settings.embedding_model:
        return None
    return recorded


def retire_remote_settings(db: Session) -> list[str]:
    """Rewrite stored settings so nothing routes to a remote provider.

    Returns the stored keys that changed, for tests and logging.
    """
    effective = get_notification_settings(db)
    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    stored = json.loads(row.value) if row is not None else {}
    changed: list[str] = []

    for field, remote_value in REMOTE_PROVIDER_VALUES.items():
        if effective.get(field) == remote_value:
            stored[field] = "local"
            changed.append(field)
            logger.warning(
                '"action": "remote_provider_retired", "setting": "%s", "was": "%s", '
                '"now": "local", "detail": "Podlog no longer offers remote inference '
                '(issue #1092)."',
                field,
                remote_value,
            )

    removed = [field for field in REMOTE_ONLY_FIELDS if field in stored]
    for field in removed:
        del stored[field]
    changed.extend(removed)
    if removed:
        # Names only: some of these are API keys.
        logger.warning(
            '"action": "remote_settings_deleted", "settings": %s', json.dumps(removed)
        )

    pinned = _embedding_model_to_pin(db, stored)
    if pinned is not None:
        stored["embedding_model"] = pinned
        changed.append("embedding_model")
        logger.warning(
            '"action": "embedding_model_pinned", "model": "%s", "detail": "No embedding '
            "model was configured, and the existing embeddings were built with this one; "
            'using it so the embed stage keeps working (issue #1092)."',
            pinned,
        )

    if changed:
        if row is not None:
            row.value = json.dumps(stored)
        else:
            db.add(SystemState(key=SETTINGS_KEY, value=json.dumps(stored)))
        db.commit()
    return changed


def run_at_startup(session_factory) -> None:
    """Startup entry point for the worker and the pipeline API. Never raises."""
    retired_env = retired_env_vars_set()
    if retired_env:
        logger.warning(
            '"action": "retired_env_vars_set", "vars": %s, "detail": "These settings '
            'configure remote inference, which Podlog is removing. Delete them from .env '
            '(issue #1092)."',
            json.dumps(retired_env),
        )
    try:
        db = session_factory()
        try:
            retire_remote_settings(db)
        finally:
            db.close()
    except Exception:  # a cleanup must never be able to block startup
        logger.exception('"action": "remote_retirement_failed"')
