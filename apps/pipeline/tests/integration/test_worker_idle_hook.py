"""Tests for worker idle hook (Issue #521)."""
from unittest.mock import patch, MagicMock

from app.worker import run_idle_hook


def test_run_idle_hook_does_nothing_when_not_stale(db_session):
    with patch("app.worker.recompute_and_store") as mock_recompute:
        run_idle_hook(db_session)
        mock_recompute.assert_not_called()


def test_run_idle_hook_triggers_recompute_when_stale(db_session):
    from app.services.meta_analysis import set_stale
    set_stale(db_session)

    with patch("app.worker.recompute_and_store") as mock_recompute:
        mock_recompute.return_value = MagicMock()
        run_idle_hook(db_session)
        mock_recompute.assert_called_once()


def test_run_idle_hook_swallows_exceptions(db_session):
    from app.services.meta_analysis import set_stale
    set_stale(db_session)

    with patch("app.worker.recompute_and_store", side_effect=RuntimeError("boom")):
        run_idle_hook(db_session)   # Must not raise
