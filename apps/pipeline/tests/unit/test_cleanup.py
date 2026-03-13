"""
Unit tests for zombie job cleanup task — GAP-01 / RISK-01
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.tasks.cleanup import cleanup_zombie_jobs, ZOMBIE_TIMEOUT_HOURS, NON_TERMINAL_STATUSES


def _make_episode(status: str, hours_old: float) -> MagicMock:
    ep = MagicMock()
    ep.id = f"ep-{status}"
    ep.status = status
    ep.updated_at = datetime.now(timezone.utc) - timedelta(hours=hours_old)
    return ep


def _make_db(episodes: list) -> MagicMock:
    db = MagicMock()
    db.query.return_value.filter.return_value.all.return_value = episodes
    return db


class TestCleanupZombieJobs:
    def test_marks_stalled_episodes_failed(self):
        ep = _make_episode("transcribing", hours_old=3)
        db = _make_db([ep])

        with patch("app.tasks.cleanup.SessionLocal", return_value=db):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 1
        assert ep.status == "failed"
        assert ep.error_class == "SYSTEM_ERROR"
        assert "worker may have been killed" in ep.error_message
        db.commit.assert_called_once()

    def test_no_stalled_episodes_returns_zero(self):
        db = _make_db([])

        with patch("app.tasks.cleanup.SessionLocal", return_value=db):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 0
        db.commit.assert_not_called()

    def test_multiple_stalled_episodes(self):
        episodes = [
            _make_episode("downloading", hours_old=5),
            _make_episode("diarizing", hours_old=4),
            _make_episode("archiving", hours_old=3),
        ]
        db = _make_db(episodes)

        with patch("app.tasks.cleanup.SessionLocal", return_value=db):
            result = cleanup_zombie_jobs()

        assert result["marked_failed"] == 3
        for ep in episodes:
            assert ep.status == "failed"
            assert ep.error_class == "SYSTEM_ERROR"

    def test_rolls_back_and_reraises_on_exception(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.all.side_effect = RuntimeError("db gone")

        with patch("app.tasks.cleanup.SessionLocal", return_value=db):
            with pytest.raises(RuntimeError, match="db gone"):
                cleanup_zombie_jobs()

        db.rollback.assert_called_once()
        db.close.assert_called_once()

    def test_non_terminal_statuses_are_complete(self):
        # Ensure the set covers every state between pending and a terminal state
        expected = {"pending", "downloading", "transcribing", "diarizing", "archiving"}
        assert set(NON_TERMINAL_STATUSES) == expected

    def test_zombie_timeout_is_two_hours(self):
        assert ZOMBIE_TIMEOUT_HOURS == 2
