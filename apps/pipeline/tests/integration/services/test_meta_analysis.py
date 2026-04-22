"""Tests for apps/pipeline/app/services/meta_analysis.py (Issue #521)."""
from datetime import datetime, timezone

from app.services.meta_analysis import (
    is_stale,
    set_stale,
    clear_stale,
    compute_snapshot,
)
from app.models import Episode, Feed, Segment, SystemState


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


def _make_feed(db_session, title="Test Feed"):
    feed = Feed(url=f"http://example.com/{title}", title=title)
    db_session.add(feed)
    db_session.commit()
    return feed


def _make_episode(db_session, feed, **kwargs):
    defaults = {
        "guid": f"guid-{datetime.now().timestamp()}",
        "audio_url": "http://example.com/a.mp3",
        "status": "done",
        "duration_secs": 600,
        "published_at": datetime(2026, 1, 15, tzinfo=timezone.utc),
    }
    defaults.update(kwargs)
    ep = Episode(feed_id=feed.id, **defaults)
    db_session.add(ep)
    db_session.commit()
    return ep


def _add_segments(db_session, ep, texts: list[str], speaker="SPEAKER_00"):
    for i, t in enumerate(texts):
        db_session.add(Segment(
            episode_id=ep.id,
            speaker_label=speaker,
            start_time=float(i * 10),
            end_time=float(i * 10 + 10),
            text=t,
        ))
    db_session.commit()


def test_compute_snapshot_per_feed_aggregates(db_session):
    feed = _make_feed(db_session, "Podcast A")
    _make_episode(db_session, feed, duration_secs=600)
    _make_episode(db_session, feed, duration_secs=1200)
    snap = compute_snapshot(db_session)

    entry = next(f for f in snap["per_feed"] if f["title"] == "Podcast A")
    assert entry["episode_count"] == 2
    assert entry["avg_length_min"] == 15.0      # (600 + 1200) / 2 / 60
    assert entry["std_length_min"] > 0          # two different values -> non-zero std


def test_compute_snapshot_excludes_non_done_episodes(db_session):
    feed = _make_feed(db_session, "Podcast B")
    _make_episode(db_session, feed, status="done", duration_secs=600)
    _make_episode(db_session, feed, status="pending", duration_secs=99999)
    snap = compute_snapshot(db_session)

    entry = next(f for f in snap["per_feed"] if f["title"] == "Podcast B")
    assert entry["episode_count"] == 1
    assert entry["avg_length_min"] == 10.0
