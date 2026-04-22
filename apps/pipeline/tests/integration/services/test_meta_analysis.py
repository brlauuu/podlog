"""Tests for apps/pipeline/app/services/meta_analysis.py (Issue #521)."""
from app.services.meta_analysis import (
    is_stale,
    set_stale,
    clear_stale,
)
from app.models import SystemState


def test_is_stale_returns_false_when_flag_missing(db_session):
    assert is_stale(db_session) is False


def test_set_stale_creates_row_with_value_true(db_session):
    set_stale(db_session)
    row = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").one()
    assert row.value == "true"
    assert is_stale(db_session) is True


def test_set_stale_is_idempotent(db_session):
    set_stale(db_session)
    set_stale(db_session)
    rows = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").all()
    assert len(rows) == 1
    assert is_stale(db_session) is True


def test_clear_stale_flips_value_to_false(db_session):
    set_stale(db_session)
    clear_stale(db_session)
    assert is_stale(db_session) is False
