"""Tests for notification digest — event logging and digest scheduling."""
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call

from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent
from app.services.digest import log_event


def _make_done_event() -> EpisodeDoneEvent:
    return EpisodeDoneEvent(
        episode_id="ep1",
        episode_title="Test Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.0,
        diarize_duration_secs=60.0,
        total_duration_secs=200.0,
        queue_remaining=5,
        queue_estimated_secs=1000.0,
    )


def _make_failed_event() -> EpisodeFailedEvent:
    return EpisodeFailedEvent(
        episode_id="ep2",
        episode_title="Bad Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
        duration_secs=1800,
        error_class="OOM",
        error_message="Out of memory",
        retry_count=3,
        retry_max=3,
        queue_remaining=2,
        queue_estimated_secs=500.0,
    )


@patch("app.services.digest.SessionLocal")
def test_log_event_inserts_done_event(mock_session_cls):
    db = MagicMock()
    mock_session_cls.return_value = db

    event = _make_done_event()
    log_event(event)

    db.add.assert_called_once()
    log_row = db.add.call_args[0][0]
    assert log_row.event_type == "episode.done"
    assert log_row.episode_id == "ep1"
    assert log_row.sent is False
    payload = json.loads(log_row.payload)
    assert payload["episode_title"] == "Test Ep"
    db.commit.assert_called_once()
    db.close.assert_called_once()


@patch("app.services.digest.SessionLocal")
def test_log_event_inserts_failed_event_as_sent(mock_session_cls):
    db = MagicMock()
    mock_session_cls.return_value = db

    event = _make_failed_event()
    log_event(event, mark_sent=True)

    log_row = db.add.call_args[0][0]
    assert log_row.event_type == "episode.failed"
    assert log_row.episode_id == "ep2"
    assert log_row.sent is True
    db.commit.assert_called_once()


from app.services.digest import is_digest_due


def test_digest_not_due_in_immediate_mode():
    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("immediate", now, last_sent=None) is False


def test_daily_digest_due_after_8am_never_sent():
    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=None) is True


def test_daily_digest_not_due_before_8am():
    now = datetime(2026, 3, 15, 7, 59, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=None) is False


def test_daily_digest_not_due_if_already_sent_today():
    now = datetime(2026, 3, 15, 10, 0, tzinfo=timezone.utc)
    last = datetime(2026, 3, 15, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=last) is False


def test_daily_digest_due_next_day():
    now = datetime(2026, 3, 16, 8, 30, tzinfo=timezone.utc)
    last = datetime(2026, 3, 15, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=last) is True


def test_weekly_digest_due_on_monday_after_8am():
    # March 16, 2026 is a Monday
    now = datetime(2026, 3, 16, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=None) is True


def test_weekly_digest_not_due_on_tuesday():
    # March 17, 2026 is a Tuesday
    now = datetime(2026, 3, 17, 8, 30, tzinfo=timezone.utc)
    last = datetime(2026, 3, 16, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=last) is False


def test_weekly_digest_not_due_on_monday_before_8am():
    now = datetime(2026, 3, 16, 7, 0, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=None) is False


def test_weekly_digest_due_next_monday():
    now = datetime(2026, 3, 23, 9, 0, tzinfo=timezone.utc)  # next Monday
    last = datetime(2026, 3, 16, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=last) is True
