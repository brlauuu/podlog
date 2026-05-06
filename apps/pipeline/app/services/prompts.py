"""LLM system-prompt registry and runtime resolver (Issue #643).

Each entry in ``PROMPT_KEYS`` declares one editable prompt: a stable key, the
``Settings`` attribute that holds the build-time default (the "reset" target),
a human label, and a description for the Settings UI. Resolution order at
runtime is: row in ``prompt_settings`` (UI override) → env var on
``settings`` (build-time default).

Adding a new prompt site:
1. Add a field to ``app.config.Settings`` (env-overridable default).
2. Add a ``PromptKey`` entry below.
3. Document the new env var in ``.env.example``.
4. Have the call site read it via ``get_prompt(db, "<key>")``.
"""
from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, func, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import PromptSetting


@dataclass(frozen=True)
class PromptKey:
    key: str
    settings_attr: str
    label: str
    description: str


PROMPT_KEYS: tuple[PromptKey, ...] = (
    PromptKey(
        key="ask_page_system",
        settings_attr="prompt_ask_page_system",
        label="Ask page — system prompt",
        description=(
            "System instructions used when answering questions on the /ask page "
            "(global search across all episodes)."
        ),
    ),
    PromptKey(
        key="ask_episode_system",
        settings_attr="prompt_ask_episode_system",
        label="Episode Ask — system prompt",
        description=(
            "System instructions used by the per-episode Ask popup. Defaults to "
            "the same text as the Ask page prompt; can be edited independently."
        ),
    ),
)

_KEY_INDEX: dict[str, PromptKey] = {p.key: p for p in PROMPT_KEYS}


def _default_for(key: str) -> str:
    meta = _KEY_INDEX.get(key)
    if meta is None:
        raise KeyError(f"Unknown prompt key: {key}")
    return getattr(settings, meta.settings_attr)


def get_prompt(db: Session, key: str) -> str:
    """Return the active prompt text — DB override if present, else env default."""
    if key not in _KEY_INDEX:
        raise KeyError(f"Unknown prompt key: {key}")
    row = db.execute(select(PromptSetting).where(PromptSetting.key == key)).scalar_one_or_none()
    if row is not None:
        return row.value
    return _default_for(key)


def set_prompt(db: Session, key: str, value: str) -> None:
    """Upsert an override row for ``key``."""
    if key not in _KEY_INDEX:
        raise KeyError(f"Unknown prompt key: {key}")
    stmt = pg_insert(PromptSetting).values(key=key, value=value)
    stmt = stmt.on_conflict_do_update(
        index_elements=[PromptSetting.key],
        set_={"value": stmt.excluded.value, "updated_at": func.now()},
    )
    db.execute(stmt)
    db.commit()


def reset_prompt(db: Session, key: str) -> None:
    """Delete the override row for ``key`` so the env-var default takes over."""
    if key not in _KEY_INDEX:
        raise KeyError(f"Unknown prompt key: {key}")
    db.execute(delete(PromptSetting).where(PromptSetting.key == key))
    db.commit()


def list_prompts(db: Session) -> list[dict]:
    """Return every registered prompt with its current value, default, and override flag."""
    rows = {
        r.key: r
        for r in db.execute(select(PromptSetting)).scalars().all()
    }
    out: list[dict] = []
    for meta in PROMPT_KEYS:
        default_value = _default_for(meta.key)
        row = rows.get(meta.key)
        out.append(
            {
                "key": meta.key,
                "label": meta.label,
                "description": meta.description,
                "value": row.value if row is not None else default_value,
                "default": default_value,
                "is_overridden": row is not None,
                "updated_at": row.updated_at.isoformat() if row is not None else None,
            }
        )
    return out
