"""Clean an upgraded install's leftovers from remote inference (#1092).

Podlog is fully self-hosted: nothing reads a provider setting or a remote API
key any more. An existing deployment still has them in the
``notification_settings`` blob, though, including API keys that should not sit
in the database once nothing uses them. This runs once per process start, in
both the worker and the pipeline API, and is idempotent:

- stored provider settings and every remote-only field (API keys included) are
  deleted, with a warning naming each provider that was still remote;
- an embedding model nobody chose is pinned to the one that built the corpus,
  because the Fireworks path embedded with ``BAAI/bge-small-en-v1.5`` while the
  local default is ``all-MiniLM-L6-v2``, and the provenance guard (#945) would
  otherwise fail every embed job;
- env vars that no longer do anything are named in one warning.

Nothing here may block startup: every failure is logged and swallowed.
"""

from __future__ import annotations

import json
import logging
import os

from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemState
from app.services import embed_provenance
from app.services.notification_settings import SETTINGS_KEY, _VALID_EMBEDDING_MODELS

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

RETIRED_FIELDS = (*REMOTE_PROVIDER_VALUES, *REMOTE_ONLY_FIELDS)


def retired_env_vars_set() -> list[str]:
    """Names of retired env vars still present in the process environment.

    Read from ``os.environ`` because the config fields that used to parse them
    are gone. Under Docker that covers ``.env``, which compose loads with
    ``env_file``; a natively run process reading ``.env`` itself is not covered.
    """
    return sorted(f.upper() for f in RETIRED_FIELDS if f.upper() in os.environ)


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
    """Delete every stored remote setting and pin the embedding model if needed.

    Returns the stored keys that changed, for tests and logging.
    """
    row = db.query(SystemState).filter(SystemState.key == SETTINGS_KEY).first()
    stored = json.loads(row.value) if row is not None else {}

    for field, remote_value in REMOTE_PROVIDER_VALUES.items():
        if stored.get(field) == remote_value:
            logger.warning(
                '"action": "remote_provider_retired", "setting": "%s", "was": "%s", '
                '"detail": "Podlog no longer offers remote inference; this step now runs '
                'locally (issue #1092)."',
                field,
                remote_value,
            )

    changed = [field for field in RETIRED_FIELDS if field in stored]
    for field in changed:
        del stored[field]
    if changed:
        # Names only: some of these are API keys.
        logger.warning(
            '"action": "remote_settings_deleted", "settings": %s', json.dumps(changed)
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
            '"action": "retired_env_vars_set", "vars": %s, "detail": "These configured '
            'remote inference, which Podlog no longer offers, and are ignored. Delete them '
            'from .env (issue #1092)."',
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
