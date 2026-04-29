"""Integration tests for prune_superseded_failed_jobs (issue #598).

Uses the real test DB so the SQL DELETE actually executes against PostgreSQL.
Each test seeds job_queue rows for a single episode, runs the prune, and
asserts on the remaining row state.
"""
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from app.models import Job
from app.tasks.cleanup import prune_superseded_failed_jobs


def _add_job(db, episode_id, task, status, *, picked_at=None):
    job = Job(
        episode_id=episode_id,
        task=task,
        status=status,
        attempt=1,
        picked_at=picked_at,
    )
    db.add(job)
    db.flush()
    return job


def _run_prune(db_session):
    """Patch SessionLocal so the prune uses the test transaction."""
    with patch("app.database.SessionLocal", return_value=db_session):
        return prune_superseded_failed_jobs()


def test_prunes_failed_when_later_done_for_same_task(db_session, sample_episode):
    """The headline case: a failed archive row sandwiched between successful ones."""
    earlier_done = _add_job(db_session, sample_episode.id, "archive", "done")
    failed = _add_job(db_session, sample_episode.id, "archive", "failed")
    later_done = _add_job(db_session, sample_episode.id, "archive", "done")
    db_session.commit()

    result = _run_prune(db_session)

    assert result == {"total": 1, "per_task": {"archive": 1}}
    remaining = {j.id for j in db_session.query(Job).all()}
    assert remaining == {earlier_done.id, later_done.id}


def test_keeps_failed_when_episode_still_pending(db_session, sample_episode):
    """No supersession yet — the user still needs to see this failure."""
    sample_episode.status = "pending"
    db_session.flush()
    failed = _add_job(db_session, sample_episode.id, "transcribe", "failed")
    db_session.commit()

    result = _run_prune(db_session)

    assert result == {"total": 0, "per_task": {}}
    assert db_session.query(Job).filter(Job.id == failed.id).first() is not None


def test_keeps_failed_when_episode_failed(db_session, sample_episode):
    """A terminal-failed episode keeps its failed rows — those are the diagnostic."""
    sample_episode.status = "failed"
    db_session.flush()
    failed = _add_job(db_session, sample_episode.id, "transcribe", "failed")
    db_session.commit()

    result = _run_prune(db_session)

    assert result == {"total": 0, "per_task": {}}
    assert db_session.query(Job).filter(Job.id == failed.id).first() is not None


def test_prunes_via_episode_done_processed_after_picked(db_session, sample_episode):
    """Even without a later same-task done row, an episode that completed after
    the failed job was picked counts as superseded."""
    picked = datetime.now(timezone.utc) - timedelta(days=2)
    failed = _add_job(db_session, sample_episode.id, "diarize", "failed", picked_at=picked)
    failed_id = failed.id
    sample_episode.status = "done"
    sample_episode.processed_at = datetime.now(timezone.utc) - timedelta(days=1)
    db_session.commit()

    result = _run_prune(db_session)

    assert result == {"total": 1, "per_task": {"diarize": 1}}
    assert db_session.query(Job).filter(Job.id == failed_id).first() is None


def test_keeps_failed_with_null_picked_at_when_no_same_task_done(db_session, sample_episode):
    """Edge case: failed row with picked_at=NULL and no later same-task done.
    Without a picked_at, the per-episode rule can't compare timestamps. Stay safe
    and keep the row."""
    sample_episode.status = "done"
    sample_episode.processed_at = datetime.now(timezone.utc)
    db_session.flush()
    failed = _add_job(db_session, sample_episode.id, "embed", "failed", picked_at=None)
    db_session.commit()

    result = _run_prune(db_session)

    assert result == {"total": 0, "per_task": {}}
    assert db_session.query(Job).filter(Job.id == failed.id).first() is not None


def test_aggregates_counts_per_task(db_session, sample_episode):
    """The summary log shows what was pruned grouped by task."""
    for _ in range(3):
        _add_job(db_session, sample_episode.id, "archive", "failed")
    _add_job(db_session, sample_episode.id, "archive", "done")  # supersedes the 3 above
    _add_job(db_session, sample_episode.id, "diarize", "failed")
    _add_job(db_session, sample_episode.id, "diarize", "done")  # supersedes the diarize one
    db_session.commit()

    result = _run_prune(db_session)

    assert result == {"total": 4, "per_task": {"archive": 3, "diarize": 1}}
