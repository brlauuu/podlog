"""Integration tests for pipeline alerts (#1099) against a real PostgreSQL.

The streak and stall queries are raw SQL over job_queue, so they only mean
something when they run on the real schema. Delivery goes through the real
notification handlers with the Telegram sender patched, so "exactly one
notification" counts what would actually have been sent.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

import pytest

from app.models import Job, SystemState
from app.services import pipeline_alerts
from app.services.digest import register_notification_handlers
from app.services.events import EventBus

NOW = datetime(2026, 10, 29, 12, 0, tzinfo=timezone.utc)

# Daily digests on purpose: alerts must still go out immediately.
_NS = {
    "notification_frequency": "daily",
    "telegram_configured": True,
    "telegram_bot_token": "token",
    "telegram_chat_id": "chat",
    "email_configured": False,
}


def _add_job(db, episode_id, task, status, *, created_at=None, picked_at=None, error=None):
    job = Job(
        episode_id=episode_id,
        task=task,
        status=status,
        attempt=1,
        error=error,
        picked_at=picked_at,
    )
    if created_at is not None:
        job.created_at = created_at
    db.add(job)
    db.flush()
    return job


@pytest.fixture
def sent(db_session):
    """Run check_pipeline_alerts on the test transaction; collect Telegram sends."""
    bus = EventBus()
    register_notification_handlers(bus)
    messages: list = []

    def run(now=NOW, streak=5, stall_hours=24):
        with patch("app.database.SessionLocal", return_value=db_session), \
             patch("app.services.digest.SessionLocal", return_value=db_session), \
             patch("app.services.digest.get_notification_settings", return_value=_NS), \
             patch("app.services.digest.send_telegram",
                   side_effect=lambda event, **_: messages.append(event)), \
             patch("app.services.events.bus", bus), \
             patch("app.services.pipeline_alerts.settings", SimpleNamespace(
                 # A stand-in, not patch.object on the real settings (#1100).
                 pipeline_alert_failure_streak=streak,
                 pipeline_alert_stall_hours=stall_hours,
             )):
            pipeline_alerts.check_pipeline_alerts(now=now)
        return messages

    return run


def test_streak_at_one_stage_sends_exactly_one_alert(db_session, sample_episode, sent):
    """The Fireworks week: transcribe fails every attempt, retries included."""
    sample_episode.error_class = "TRANSIENT_NETWORK"
    _add_job(db_session, sample_episode.id, "transcribe", "done")
    for _ in range(5):
        _add_job(db_session, sample_episode.id, "transcribe", "failed",
                 error="503 no healthy upstream")
    db_session.commit()

    messages = sent()
    assert len(messages) == 1
    alert = messages[0]
    assert alert.kind == "failure_streak" and alert.stage == "transcribe"
    assert not alert.recovered
    assert alert.headline == "transcribe: 5 consecutive failures (TRANSIENT_NETWORK)"
    assert ("Last error", "503 no healthy upstream") in alert.details

    # The next periodic runs, with more failures piling up, stay quiet.
    _add_job(db_session, sample_episode.id, "transcribe", "failed", error="503")
    db_session.commit()
    assert len(sent()) == 1
    assert len(sent()) == 1


def test_below_threshold_sends_nothing(db_session, sample_episode, sent):
    for _ in range(4):
        _add_job(db_session, sample_episode.id, "transcribe", "failed", error="boom")
    db_session.commit()
    assert sent() == []


def test_failures_before_a_success_do_not_count(db_session, sample_episode, sent):
    for _ in range(6):
        _add_job(db_session, sample_episode.id, "diarize", "failed", error="boom")
    _add_job(db_session, sample_episode.id, "diarize", "done")
    db_session.commit()
    assert sent() == []


def test_success_after_alert_sends_one_recovery(db_session, sample_episode, sent):
    for _ in range(5):
        _add_job(db_session, sample_episode.id, "embed", "failed", error="boom")
    db_session.commit()
    assert len(sent()) == 1

    _add_job(db_session, sample_episode.id, "embed", "done")
    db_session.commit()
    messages = sent()
    assert len(messages) == 2
    assert messages[1].recovered and messages[1].stage == "embed"
    assert len(sent()) == 2

    # Re-armed: a fresh streak alerts again.
    for _ in range(5):
        _add_job(db_session, sample_episode.id, "embed", "failed", error="boom")
    db_session.commit()
    assert len(sent()) == 3


def test_idle_install_sends_nothing(db_session, sample_episode, sent):
    """Old work all done, queue empty, nothing finished for weeks: not a stall."""
    long_ago = NOW - timedelta(days=30)
    _add_job(db_session, sample_episode.id, "archive", "done",
             created_at=long_ago, picked_at=long_ago)
    db_session.commit()
    assert sent() == []
    assert db_session.query(SystemState).filter(
        SystemState.key == pipeline_alerts.STATE_KEY
    ).first() is None


def test_waiting_work_with_no_progress_alerts_once_then_recovers(
    db_session, sample_episode, sent
):
    two_days = NOW - timedelta(days=2)
    _add_job(db_session, sample_episode.id, "download", "done",
             created_at=two_days, picked_at=two_days)
    _add_job(db_session, sample_episode.id, "transcribe", "pending", created_at=two_days)
    db_session.commit()

    messages = sent()
    assert len(messages) == 1
    assert messages[0].kind == "stall" and not messages[0].recovered
    assert messages[0].headline == "Queue stalled: nothing finished in 2 days"
    assert len(sent()) == 1

    later = NOW + timedelta(hours=1)
    db_session.query(Job).filter(Job.task == "transcribe").update(
        {"status": "done", "picked_at": NOW}
    )
    db_session.commit()
    messages = sent(now=later)
    assert len(messages) == 2
    assert messages[1].kind == "stall" and messages[1].recovered


def test_a_hung_job_with_nothing_behind_it_is_a_stall(db_session, sample_episode, sent):
    """An in-flight job is status 'picked'. The query once looked for 'running',
    a status job_queue never uses, so a queue holding only a hung job read as empty."""
    two_days = NOW - timedelta(days=2)
    _add_job(db_session, sample_episode.id, "download", "done",
             created_at=two_days, picked_at=two_days)
    _add_job(db_session, sample_episode.id, "diarize", "picked",
             created_at=two_days, picked_at=two_days)
    db_session.commit()

    messages = sent()
    assert len(messages) == 1
    assert messages[0].kind == "stall" and not messages[0].recovered
    assert ("Jobs waiting", "1") in messages[0].details


def test_busy_queue_with_recent_progress_is_not_a_stall(db_session, sample_episode, sent):
    """A long backlog is fine as long as jobs keep finishing."""
    _add_job(db_session, sample_episode.id, "transcribe", "pending",
             created_at=NOW - timedelta(days=5))
    _add_job(db_session, sample_episode.id, "download", "done",
             created_at=NOW - timedelta(hours=1), picked_at=NOW - timedelta(hours=1))
    db_session.commit()
    assert sent() == []


def test_zero_disables_both_checks(db_session, sample_episode, sent):
    two_days = NOW - timedelta(days=2)
    for _ in range(5):
        _add_job(db_session, sample_episode.id, "transcribe", "failed", error="boom")
    _add_job(db_session, sample_episode.id, "transcribe", "pending", created_at=two_days)
    db_session.commit()
    assert sent(streak=0, stall_hours=0) == []
