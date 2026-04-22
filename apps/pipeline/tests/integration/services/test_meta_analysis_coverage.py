"""Coverage and inclusion-rule tests for compute_snapshot (Issue #521)."""
import uuid
from datetime import datetime, timezone

from app.services.meta_analysis import compute_snapshot
from app.models import Feed, Episode, Segment, SpeakerName, Chunk


def _make_feed(db, title, itunes_owner_name=None):
    feed = Feed(url=f"http://ex.com/{title}", title=title,
                itunes_owner_name=itunes_owner_name)
    db.add(feed)
    db.commit()
    return feed


def _make_ep(db, feed, **k):
    k.setdefault("guid", f"g-{uuid.uuid4()}")
    k.setdefault("audio_url", "x")
    k.setdefault("status", "done")
    k.setdefault("duration_secs", 120)
    k.setdefault("published_at", datetime(2026, 1, 1, tzinfo=timezone.utc))
    ep = Episode(feed_id=feed.id, **k)
    db.add(ep); db.commit()
    return ep


def test_host_share_included_when_confirmed_host_matches_feed_owner(db_session):
    feed = _make_feed(db_session, "Pod X", itunes_owner_name="Alice")
    ep = _make_ep(db_session, feed)
    # S0 (host) occupies 30s; S1 (guest) occupies 10s. host_share = 30/40 = 0.75,
    # which falls inside the 0.5 < x < 1.0 assertion below. The task-spec draft
    # had both segments 30s long (exact 0.5), which fails the strict inequality.
    db_session.add_all([
        Segment(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=30,
                text="alice speaking " * 10),
        Segment(episode_id=ep.id, speaker_label="S1", start_time=30, end_time=40,
                text="guest here"),
        SpeakerName(episode_id=ep.id, speaker_label="S0",
                    display_name="Alice", confirmed_by_user=True),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    assert snap["coverage"]["host_share"]["included_count"] == 1
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)
    assert ep_entry["host_share"] is not None
    assert 0.5 < ep_entry["host_share"] < 1.0


def test_host_share_excluded_when_feed_has_no_host_hint(db_session):
    feed = _make_feed(db_session, "Pod Y")   # no itunes_owner_name
    ep = _make_ep(db_session, feed)
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10, text="hi"
    ))
    db_session.commit()

    snap = compute_snapshot(db_session)
    excl = snap["coverage"]["host_share"]["excluded"]
    assert any(e["episode_id"] == ep.id for e in excl)
    assert any(e["reason"] == "feed has no identified host" for e in excl)


def test_host_share_excluded_when_episode_has_no_confirmed_host(db_session):
    feed = _make_feed(db_session, "Pod Z", itunes_owner_name="Alice")
    ep = _make_ep(db_session, feed)
    db_session.add_all([
        Segment(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10,
                text="some text"),
        SpeakerName(episode_id=ep.id, speaker_label="S0",
                    display_name="Alice", confidence="LOW", inferred=True),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    excl = snap["coverage"]["host_share"]["excluded"]
    assert any(
        e["episode_id"] == ep.id and e["reason"] == "no confirmed host in episode"
        for e in excl
    )


def test_tokens_chunks_excluded_when_no_chunks(db_session):
    feed = _make_feed(db_session, "Pod T")
    ep = _make_ep(db_session, feed)
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10, text="hi"
    ))
    db_session.commit()

    snap = compute_snapshot(db_session)
    excl = snap["coverage"]["tokens_chunks"]["excluded"]
    assert any(e["episode_id"] == ep.id and e["reason"] == "no chunks yet" for e in excl)


def test_tokens_chunks_included_when_chunks_exist(db_session):
    feed = _make_feed(db_session, "Pod U")
    ep = _make_ep(db_session, feed)
    db_session.add_all([
        Segment(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10, text="hi"),
        Chunk(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10,
              text="hi there", segment_ids=[]),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    assert snap["coverage"]["tokens_chunks"]["included_count"] == 1
