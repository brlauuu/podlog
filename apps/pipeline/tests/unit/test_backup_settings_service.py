"""Unit tests for app.services.backup_settings (#762).

The integration suite at tests/integration/services/test_backup_settings.py
covers these paths against a real DB; this suite mirrors it against a fake
SQLAlchemy Session so CI's `pytest tests/unit --cov=app` measurement
reflects the real coverage.
"""
from __future__ import annotations

import json
from typing import Any

import pytest

from app.config import settings
from app.models import SystemState
from app.services.backup_settings import (
    SETTINGS_KEY,
    get_backup_retention,
    save_backup_retention,
)


def _env_default() -> dict[str, int]:
    return {
        "daily": int(settings.backup_retention_daily),
        "weekly": int(settings.backup_retention_weekly),
        "monthly": int(settings.backup_retention_monthly),
    }


class _FakeQuery:
    def __init__(self, row: Any) -> None:
        self._row = row

    def filter(self, *_args: Any, **_kwargs: Any) -> "_FakeQuery":
        return self

    def first(self) -> Any:
        return self._row


class _FakeSession:
    """Minimal stand-in for sqlalchemy.orm.Session.

    Only implements what backup_settings.py actually uses: query/filter/first,
    add, commit. Mutations to a row's `.value` flow through because the row is
    the same object held in `self.row`.
    """

    def __init__(self, row: SystemState | None = None) -> None:
        self.row = row
        self.added: list[SystemState] = []
        self.commits = 0

    def query(self, _model: Any) -> _FakeQuery:
        return _FakeQuery(self.row)

    def add(self, obj: SystemState) -> None:
        self.added.append(obj)
        # Mirror SQLAlchemy semantics: a freshly added row becomes the
        # tracked row for subsequent .query().first() reads.
        self.row = obj

    def commit(self) -> None:
        self.commits += 1


# ---- get_backup_retention ---------------------------------------------------


def test_get_returns_env_defaults_when_no_row():
    db = _FakeSession(row=None)
    assert get_backup_retention(db) == _env_default()


def test_get_returns_stored_values_when_row_present():
    row = SystemState(
        key=SETTINGS_KEY,
        value=json.dumps({"daily": 5, "weekly": 2, "monthly": 6}),
    )
    db = _FakeSession(row=row)
    assert get_backup_retention(db) == {"daily": 5, "weekly": 2, "monthly": 6}


def test_get_falls_back_to_env_when_row_is_malformed_json():
    db = _FakeSession(row=SystemState(key=SETTINGS_KEY, value="not json"))
    assert get_backup_retention(db) == _env_default()


def test_get_falls_back_to_env_when_value_is_none():
    # json.loads(None) raises TypeError — exercised path.
    db = _FakeSession(row=SystemState(key=SETTINGS_KEY, value=None))
    assert get_backup_retention(db) == _env_default()


def test_get_ignores_non_int_stored_values():
    row = SystemState(
        key=SETTINGS_KEY,
        value=json.dumps({"daily": "lots", "weekly": 2, "monthly": 6}),
    )
    db = _FakeSession(row=row)
    out = get_backup_retention(db)
    assert out["daily"] == _env_default()["daily"]
    assert out["weekly"] == 2
    assert out["monthly"] == 6


def test_get_ignores_negative_stored_values():
    row = SystemState(
        key=SETTINGS_KEY,
        value=json.dumps({"daily": -1, "weekly": 2, "monthly": 6}),
    )
    db = _FakeSession(row=row)
    out = get_backup_retention(db)
    assert out["daily"] == _env_default()["daily"]
    assert out["weekly"] == 2
    assert out["monthly"] == 6


def test_get_ignores_missing_keys_in_stored_blob():
    """Partial blob (only daily) should fall back to env for weekly/monthly."""
    row = SystemState(key=SETTINGS_KEY, value=json.dumps({"daily": 4}))
    db = _FakeSession(row=row)
    out = get_backup_retention(db)
    assert out["daily"] == 4
    assert out["weekly"] == _env_default()["weekly"]
    assert out["monthly"] == _env_default()["monthly"]


# ---- save_backup_retention (insert path) ------------------------------------


def test_save_inserts_when_no_row_exists():
    db = _FakeSession(row=None)
    result = save_backup_retention(db, {"daily": 5, "weekly": 2, "monthly": 6})

    assert result == {"daily": 5, "weekly": 2, "monthly": 6}
    assert len(db.added) == 1
    added = db.added[0]
    assert added.key == SETTINGS_KEY
    assert json.loads(added.value) == {"daily": 5, "weekly": 2, "monthly": 6}
    assert db.commits == 1


def test_save_updates_existing_row_without_adding():
    existing = SystemState(
        key=SETTINGS_KEY,
        value=json.dumps({"daily": 9, "weekly": 9, "monthly": 9}),
    )
    db = _FakeSession(row=existing)
    save_backup_retention(db, {"daily": 1, "weekly": 0, "monthly": 0})

    assert db.added == []
    assert json.loads(existing.value) == {"daily": 1, "weekly": 0, "monthly": 0}
    assert db.commits == 1


def test_save_partial_payload_uses_env_defaults():
    db = _FakeSession(row=None)
    result = save_backup_retention(db, {"daily": 3})
    assert result["daily"] == 3
    assert result["weekly"] == _env_default()["weekly"]
    assert result["monthly"] == _env_default()["monthly"]


def test_save_accepts_all_zero_opt_out():
    db = _FakeSession(row=None)
    result = save_backup_retention(db, {"daily": 0, "weekly": 0, "monthly": 0})
    assert result == {"daily": 0, "weekly": 0, "monthly": 0}


# ---- save_backup_retention (validation) -------------------------------------


def test_save_rejects_negative_daily():
    db = _FakeSession(row=None)
    with pytest.raises(ValueError, match="non-negative"):
        save_backup_retention(db, {"daily": -1, "weekly": 0, "monthly": 0})
    assert db.commits == 0


def test_save_rejects_non_int_payload():
    db = _FakeSession(row=None)
    with pytest.raises((ValueError, TypeError)):
        save_backup_retention(db, {"daily": "lots", "weekly": 0, "monthly": 0})
    assert db.commits == 0


def test_save_rejects_daily_zero_with_weekly_positive():
    db = _FakeSession(row=None)
    with pytest.raises(ValueError, match="daily=0"):
        save_backup_retention(db, {"daily": 0, "weekly": 4, "monthly": 0})
    assert db.commits == 0


def test_save_rejects_daily_zero_with_monthly_positive():
    db = _FakeSession(row=None)
    with pytest.raises(ValueError, match="daily=0"):
        save_backup_retention(db, {"daily": 0, "weekly": 0, "monthly": 12})
    assert db.commits == 0


def test_save_then_get_round_trip():
    db = _FakeSession(row=None)
    save_backup_retention(db, {"daily": 7, "weekly": 4, "monthly": 12})
    assert get_backup_retention(db) == {"daily": 7, "weekly": 4, "monthly": 12}
