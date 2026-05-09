"""Integration tests for app.services.backup_settings (Issue #683)."""
import json

import pytest

from app.config import settings
from app.models import SystemState
from app.services.backup_settings import (
    SETTINGS_KEY,
    get_backup_retention,
    save_backup_retention,
)


def _env_default():
    return {
        "daily": int(settings.backup_retention_daily),
        "weekly": int(settings.backup_retention_weekly),
        "monthly": int(settings.backup_retention_monthly),
    }


def test_get_returns_env_defaults_when_no_row(db_session):
    assert get_backup_retention(db_session) == _env_default()


def test_save_then_get_round_trip(db_session):
    saved = save_backup_retention(db_session, {"daily": 5, "weekly": 2, "monthly": 6})
    assert saved == {"daily": 5, "weekly": 2, "monthly": 6}

    loaded = get_backup_retention(db_session)
    assert loaded == {"daily": 5, "weekly": 2, "monthly": 6}


def test_save_is_upsert(db_session):
    save_backup_retention(db_session, {"daily": 5, "weekly": 2, "monthly": 6})
    save_backup_retention(db_session, {"daily": 1, "weekly": 0, "monthly": 0})

    rows = db_session.query(SystemState).filter(SystemState.key == SETTINGS_KEY).all()
    assert len(rows) == 1
    assert json.loads(rows[0].value) == {"daily": 1, "weekly": 0, "monthly": 0}


def test_save_rejects_daily_zero_with_weekly_positive(db_session):
    with pytest.raises(ValueError, match="daily=0"):
        save_backup_retention(db_session, {"daily": 0, "weekly": 4, "monthly": 0})


def test_save_rejects_daily_zero_with_monthly_positive(db_session):
    with pytest.raises(ValueError, match="daily=0"):
        save_backup_retention(db_session, {"daily": 0, "weekly": 0, "monthly": 12})


def test_save_accepts_all_zero(db_session):
    """All retention 0 is the explicit opt-out — allowed."""
    save_backup_retention(db_session, {"daily": 0, "weekly": 0, "monthly": 0})
    assert get_backup_retention(db_session) == {"daily": 0, "weekly": 0, "monthly": 0}


def test_save_rejects_negative(db_session):
    with pytest.raises(ValueError, match="non-negative"):
        save_backup_retention(db_session, {"daily": -1, "weekly": 0, "monthly": 0})


def test_save_rejects_non_int(db_session):
    with pytest.raises((ValueError, TypeError)):
        save_backup_retention(db_session, {"daily": "lots", "weekly": 0, "monthly": 0})


def test_get_falls_back_when_row_is_malformed(db_session):
    db_session.add(SystemState(key=SETTINGS_KEY, value="not json"))
    db_session.commit()

    assert get_backup_retention(db_session) == _env_default()


def test_partial_payload_uses_env_defaults_for_missing_keys(db_session):
    """Sending only `daily` keeps weekly/monthly at env defaults."""
    saved = save_backup_retention(db_session, {"daily": 3})
    assert saved["daily"] == 3
    assert saved["weekly"] == _env_default()["weekly"]
    assert saved["monthly"] == _env_default()["monthly"]
