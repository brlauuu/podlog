"""Tests for queue_snapshot.recent_activity against a real database (#1079).

The unit tests mock db.execute, so the SQL itself -- which statuses count,
which timestamp times them, the stuck rule -- is only exercised here.
"""
import uuid
from datetime import datetime, timedelta, timezone

from app.models import Episode, Job
from app.services.queue_snapshot import recent_activity

NOW = datetime.now(timezone.utc)


def _episode(db, feed, status, *, processed_at=None, updated_at=None, title=None):
    ep = Episode(
        id=str(uuid.uuid4()),
        feed_id=feed.id,
        guid=f"guid-{uuid.uuid4().hex[:8]}",
        title=title or status,
        audio_url="https://example.com/a.mp3",
        published_at=NOW - timedelta(days=30),
        status=status,
        processed_at=processed_at,
        updated_at=updated_at or NOW,
    )
    db.add(ep)
    db.flush()
    return ep


def _ids(rows):
    # Raw SQL hands uuid columns back as uuid.UUID; FastAPI serialises them.
    return {str(r["episode_id"]) for r in rows}


def _by_id(rows):
    return {str(r["episode_id"]): r for r in rows}


def test_done_and_no_speech_count_as_done(db_session, sample_feed):
    done = _episode(db_session, sample_feed, "done", processed_at=NOW - timedelta(hours=1))
    silent = _episode(db_session, sample_feed, "no_speech")

    rows = _by_id(recent_activity(db_session))

    assert rows[done.id]["outcome"] == "done"
    assert rows[silent.id]["outcome"] == "done"


def test_failed_counts_as_failed(db_session, sample_feed):
    failed = _episode(db_session, sample_feed, "failed")

    rows = _by_id(recent_activity(db_session))

    assert rows[failed.id]["outcome"] == "failed"


def test_stuck_counts_as_failed_but_in_flight_does_not_appear(db_session, sample_feed):
    stuck = _episode(db_session, sample_feed, "transcribing")
    working = _episode(db_session, sample_feed, "transcribing")
    db_session.add(Job(episode_id=working.id, task="transcribe", status="picked"))
    waiting = _episode(db_session, sample_feed, "pending")
    db_session.add(Job(episode_id=waiting.id, task="download", status="pending"))
    db_session.flush()

    rows = _by_id(recent_activity(db_session))

    assert rows[stuck.id]["outcome"] == "failed"
    assert working.id not in rows
    assert waiting.id not in rows


def test_done_is_timed_by_processed_at_not_updated_at(db_session, sample_feed):
    # Processed long ago, touched recently (e.g. a later write to the row):
    # it was not processed this week, so it does not belong on the roller.
    old = _episode(
        db_session, sample_feed, "done",
        processed_at=NOW - timedelta(days=20), updated_at=NOW,
    )

    assert old.id not in _ids(recent_activity(db_session))


def test_window_excludes_older_entries(db_session, sample_feed):
    recent = _episode(db_session, sample_feed, "failed", updated_at=NOW - timedelta(days=6))
    stale = _episode(db_session, sample_feed, "failed", updated_at=NOW - timedelta(days=8))

    ids = _ids(recent_activity(db_session, days=7))

    assert recent.id in ids
    assert stale.id not in ids


def test_newest_first_with_feed_details(db_session, sample_feed):
    sample_feed.image_url = "https://example.com/art.jpg"
    older = _episode(db_session, sample_feed, "done", processed_at=NOW - timedelta(days=2))
    newer = _episode(db_session, sample_feed, "failed", updated_at=NOW - timedelta(hours=2))

    rows = [r for r in recent_activity(db_session) if str(r["episode_id"]) in {older.id, newer.id}]

    assert [str(r["episode_id"]) for r in rows] == [newer.id, older.id]
    assert rows[0]["feed_title"] == "Test Podcast"
    assert rows[0]["feed_image_url"] == "https://example.com/art.jpg"
    assert rows[0]["published_at"] is not None
