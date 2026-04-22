"""Tests for apps/pipeline/app/services/meta_analysis.py (Issue #521)."""
import uuid
from datetime import datetime, timezone

from app.services.meta_analysis import (
    is_stale,
    set_stale,
    clear_stale,
    compute_snapshot,
)
from app.models import Chunk, Episode, Feed, Segment, SpeakerName, SystemState


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
        "guid": f"guid-{uuid.uuid4()}",
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


def test_compute_snapshot_per_feed_sums_cost_and_audio_minutes(db_session):
    feed = _make_feed(db_session, "Podcast C")
    _make_episode(db_session, feed, fireworks_stt_cost_usd=0.12, fireworks_audio_minutes=10.0)
    _make_episode(db_session, feed, fireworks_stt_cost_usd=0.08, fireworks_audio_minutes=5.0)
    snap = compute_snapshot(db_session)

    entry = next(f for f in snap["per_feed"] if f["title"] == "Podcast C")
    assert entry["total_cost_usd"] == 0.20
    assert entry["total_audio_minutes"] == 15.0


def test_compute_snapshot_per_episode_counts_words_and_tokens(db_session):
    feed = _make_feed(db_session, "Podcast C")
    ep = _make_episode(db_session, feed, duration_secs=60)
    _add_segments(db_session, ep, ["Hello world", "Short segment here"])

    snap = compute_snapshot(db_session)
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)

    assert ep_entry["word_count"] == 5        # "Hello world" + "Short segment here"
    assert ep_entry["token_count_segments"] > 0
    assert ep_entry["feed_id"] == feed.id
    assert ep_entry["duration_secs"] == 60

    feed_entry = next(f for f in snap["per_feed"] if f["feed_id"] == feed.id)
    assert feed_entry["total_words"] == 5
    assert feed_entry["total_tokens_segments"] > 0


def test_compute_snapshot_per_episode_handles_no_chunks(db_session):
    feed = _make_feed(db_session, "Podcast D")
    ep = _make_episode(db_session, feed, duration_secs=120)
    _add_segments(db_session, ep, ["a b c"])

    snap = compute_snapshot(db_session)
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)
    assert ep_entry["token_count_chunks"] == 0


def test_compute_snapshot_per_episode_counts_chunks_when_present(db_session):
    feed = _make_feed(db_session, "Podcast E")
    ep = _make_episode(db_session, feed, duration_secs=120)
    _add_segments(db_session, ep, ["hello"])
    db_session.add(Chunk(
        episode_id=ep.id,
        speaker_label="SPEAKER_00",
        start_time=0.0,
        end_time=10.0,
        text="hello world this is a chunk",
        segment_ids=[],
    ))
    db_session.commit()

    snap = compute_snapshot(db_session)
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)
    assert ep_entry["token_count_chunks"] > 0


def test_compute_snapshot_per_speaker_aggregates_by_confirmed_name(db_session):
    feed = _make_feed(db_session, "Podcast F")
    ep = _make_episode(db_session, feed, duration_secs=120)
    _add_segments(db_session, ep, ["one two three", "four five"], speaker="SPEAKER_00")
    _add_segments(db_session, ep, ["six seven"], speaker="SPEAKER_01")
    db_session.add_all([
        SpeakerName(episode_id=ep.id, speaker_label="SPEAKER_00",
                    display_name="Alice", confirmed_by_user=True),
        SpeakerName(episode_id=ep.id, speaker_label="SPEAKER_01",
                    display_name="Unconfirmed Bob", confidence="LOW", inferred=True),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    names = {s["speaker_display_name"] for s in snap["per_speaker"]}
    assert "Alice" in names
    assert "Unconfirmed Bob" not in names   # LOW confidence, unconfirmed → excluded

    alice = next(s for s in snap["per_speaker"] if s["speaker_display_name"] == "Alice")
    assert alice["total_words"] == 5
    assert alice["turn_count"] == 1


def test_compute_snapshot_per_speaker_aggregates_across_episodes(db_session):
    feed = _make_feed(db_session, "Podcast G")
    ep1 = _make_episode(db_session, feed, duration_secs=120)
    ep2 = _make_episode(db_session, feed, duration_secs=120)
    # Alice speaks in both episodes, under the same display name but with
    # labels that happen to differ per episode (pyannote label identity
    # does not persist across episodes).
    _add_segments(db_session, ep1, ["one two three", "four five"], speaker="SPEAKER_00")
    _add_segments(db_session, ep2, ["six seven", "eight nine ten"], speaker="SPEAKER_01")
    # Distinct speaker in ep2, placed at a later start_time than Alice's
    # segments so ordering is unambiguous under ORDER BY start_time.
    db_session.add(Segment(
        episode_id=ep2.id,
        speaker_label="SPEAKER_02",
        start_time=100.0,
        end_time=110.0,
        text="bob line",
    ))
    db_session.add_all([
        SpeakerName(episode_id=ep1.id, speaker_label="SPEAKER_00",
                    display_name="Alice Smith", confidence="HIGH", inferred=True),
        SpeakerName(episode_id=ep2.id, speaker_label="SPEAKER_01",
                    display_name="Alice Smith", confidence="HIGH", inferred=True),
        SpeakerName(episode_id=ep2.id, speaker_label="SPEAKER_02",
                    display_name="Bob Jones", confirmed_by_user=True),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    podcast_g_speakers = [s for s in snap["per_speaker"] if s["feed_id"] == feed.id]

    # Exactly one Alice row despite appearing in two episodes.
    alice_rows = [s for s in podcast_g_speakers if s["speaker_display_name"] == "Alice Smith"]
    assert len(alice_rows) == 1
    alice = alice_rows[0]
    assert alice["episode_count"] == 2
    assert sorted(alice["episode_ids"]) == sorted([ep1.id, ep2.id])
    # ep1: 3 + 2 = 5 words; ep2: 2 + 3 = 5 words; total 10.
    assert alice["total_words"] == 10
    # Two segments in each episode for Alice -> 4 x 10s = 40s.
    assert alice["total_seconds"] == 40.0
    # Turn count increments when normalized speaker changes vs the previous
    # segment. Within ep1 Alice is the sole speaker (1 turn). Within ep2
    # Alice speaks both her segments contiguously (1 turn), then Bob
    # speaks (that increments Bob's counter, not Alice's). Alice total = 2.
    assert alice["turn_count"] == 2

    # Bob is distinct from Alice and sorted after her (alphabetically) in
    # the stable output order.
    bob_rows = [s for s in podcast_g_speakers if s["speaker_display_name"] == "Bob Jones"]
    assert len(bob_rows) == 1
    assert bob_rows[0]["episode_count"] == 1

    # Stable ordering: for this feed, entries sorted by normalized_name.
    assert [s["normalized_name"] for s in podcast_g_speakers] == ["alice smith", "bob jones"]


def test_compute_snapshot_timeline_monthly_buckets_by_month(db_session):
    feed = _make_feed(db_session, "Podcast G")
    _make_episode(
        db_session, feed,
        published_at=datetime(2026, 1, 10, tzinfo=timezone.utc),
        duration_secs=600,
    )
    _make_episode(
        db_session, feed,
        published_at=datetime(2026, 1, 25, tzinfo=timezone.utc),
        duration_secs=1200,
    )
    _make_episode(
        db_session, feed,
        published_at=datetime(2026, 2, 5, tzinfo=timezone.utc),
        duration_secs=600,
    )

    snap = compute_snapshot(db_session)
    jan = next(
        t for t in snap["timeline_monthly"]
        if t["feed_id"] == feed.id and t["month"] == "2026-01"
    )
    feb = next(
        t for t in snap["timeline_monthly"]
        if t["feed_id"] == feed.id and t["month"] == "2026-02"
    )
    assert jan["episode_count"] == 2
    assert jan["total_duration_min"] == 30    # (600 + 1200) / 60
    assert feb["episode_count"] == 1
