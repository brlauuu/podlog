"""Tests for apps/pipeline/app/services/meta_analysis.py (Issue #521)."""
import uuid
from datetime import datetime, timezone

import pytest

from app.services import meta_analysis as ma
from app.services.meta_analysis import (
    is_stale,
    set_stale,
    clear_stale,
    compute_snapshot,
    recompute_and_store,
)
from app.models import Chunk, Episode, Feed, Segment, SpeakerName, SystemState


def test_is_stale_returns_false_when_flag_missing(db_session):
    assert is_stale(db_session) is False


def test_set_stale_writes_unique_token(db_session):
    set_stale(db_session)
    row = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").one()
    uuid.UUID(row.value)  # raises if not a valid UUID
    assert row.value != "false"
    assert is_stale(db_session) is True


def test_set_stale_rotates_token_on_each_call(db_session):
    set_stale(db_session)
    first = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").one().value
    set_stale(db_session)
    rows = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").all()
    assert len(rows) == 1
    assert rows[0].value != first
    assert is_stale(db_session) is True


def test_clear_stale_flips_value_to_false(db_session):
    set_stale(db_session)
    clear_stale(db_session)
    row = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").one()
    assert row.value == "false"
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


def test_recompute_and_store_clears_stale_on_happy_path(db_session):
    set_stale(db_session)
    recompute_and_store(db_session)
    assert is_stale(db_session) is False


def test_recompute_and_store_preserves_stale_if_set_during_compute(db_session, monkeypatch):
    """If set_stale is called while compute_snapshot runs, the token rotates
    and recompute_and_store must NOT clear the flag — otherwise the signal is
    silently dropped. Regression test for issue #521 review finding."""
    set_stale(db_session)

    real_compute = ma.compute_snapshot

    def compute_with_concurrent_set(db):
        set_stale(db)  # simulate a speaker rename landing mid-compute
        return real_compute(db)

    monkeypatch.setattr(ma, "compute_snapshot", compute_with_concurrent_set)

    recompute_and_store(db_session)
    assert is_stale(db_session) is True


def test_recompute_and_store_preserves_stale_when_set_during_fresh_compute(
    db_session, monkeypatch
):
    """Manual /refresh path: nothing stale initially, but a writer calls
    set_stale mid-compute. Captured token was None, so _clear_stale_if_token
    skips unconditionally — the freshly-set flag must survive."""
    assert is_stale(db_session) is False

    real_compute = ma.compute_snapshot

    def compute_with_concurrent_set(db):
        set_stale(db)
        return real_compute(db)

    monkeypatch.setattr(ma, "compute_snapshot", compute_with_concurrent_set)

    recompute_and_store(db_session)
    assert is_stale(db_session) is True


def test_compute_snapshot_excludes_manual_uploads(db_session):
    """Episodes without a feed (manual uploads) must not break compute_snapshot
    and must not appear in per_episode / per_speaker outputs — the dashboard
    is feed-centric. Regression: NoneType < str sort failure during smoke
    test of the initial /refresh call."""
    feed = _make_feed(db_session, "Podcast A")
    ep_with_feed = _make_episode(db_session, feed)
    _add_segments(db_session, ep_with_feed, ["hello world"])
    db_session.add(SpeakerName(
        episode_id=ep_with_feed.id,
        speaker_label="SPEAKER_00",
        display_name="Alice",
        confirmed_by_user=True,
    ))

    manual_ep = Episode(
        feed_id=None,
        guid=f"manual-{uuid.uuid4()}",
        audio_url="http://example.com/manual.mp3",
        status="done",
        duration_secs=600,
        published_at=datetime(2026, 1, 15, tzinfo=timezone.utc),
    )
    db_session.add(manual_ep)
    db_session.commit()
    _add_segments(db_session, manual_ep, ["manual upload"])
    db_session.add(SpeakerName(
        episode_id=manual_ep.id,
        speaker_label="SPEAKER_00",
        display_name="Bob",
        confirmed_by_user=True,
    ))
    db_session.commit()

    snap = compute_snapshot(db_session)
    ep_ids = {ep["episode_id"] for ep in snap["per_episode"]}
    assert manual_ep.id not in ep_ids
    assert ep_with_feed.id in ep_ids

    speaker_names = {s["speaker_display_name"] for s in snap["per_speaker"]}
    assert "Bob" not in speaker_names
    assert "Alice" in speaker_names


# ---------------------------------------------------------------------------
# _per_episode_speaker tests (TDD — Task 1.1)
# ---------------------------------------------------------------------------

from app.services.meta_analysis_aggregations import _per_episode_speaker  # noqa: E402


def _add_speaker_name(db_session, ep, speaker_label, display_name, **kwargs):
    """Helper: add a SpeakerName row and commit."""
    sn = SpeakerName(
        episode_id=ep.id,
        speaker_label=speaker_label,
        display_name=display_name,
        **kwargs,
    )
    db_session.add(sn)
    db_session.commit()
    return sn


def test_per_episode_speaker_returns_confirmed_rows(db_session):
    """Confirmed host/guest rows must appear with correct key set and types."""
    feed = _make_feed(db_session, "Feed PES A")
    ep = _make_episode(
        db_session, feed,
        published_at=datetime(2026, 3, 1, tzinfo=timezone.utc),
        duration_secs=120,
    )
    _add_segments(db_session, ep, ["hello world foo", "bar baz"], speaker="SPEAKER_00")
    _add_speaker_name(
        db_session, ep, "SPEAKER_00", "Alice Host",
        confirmed_by_user=True, role="host",
    )

    rows = _per_episode_speaker(db_session)
    alice_rows = [r for r in rows if r["display_name"] == "Alice Host"]
    assert len(alice_rows) == 1

    row = alice_rows[0]
    # Key set
    for key in ("feed_id", "feed_title", "episode_id", "episode_title",
                "published_at", "display_name", "role", "source", "minutes", "words"):
        assert key in row, f"missing key: {key}"

    assert row["source"] == "confirmed"
    assert row["role"] in ("host", "guest")
    assert isinstance(row["minutes"], float)
    assert isinstance(row["words"], int)
    assert row["feed_id"] == feed.id
    assert row["episode_id"] == ep.id
    assert row["words"] == 5   # "hello world foo" + "bar baz"
    assert row["minutes"] == pytest.approx(20.0 / 60.0, rel=1e-4)


def test_per_episode_speaker_returns_inferred_high_rows(db_session):
    """Inferred-HIGH rows must have source='inferred_high' and role=None."""
    feed = _make_feed(db_session, "Feed PES B")
    ep = _make_episode(
        db_session, feed,
        published_at=datetime(2026, 3, 2, tzinfo=timezone.utc),
        duration_secs=60,
    )
    _add_segments(db_session, ep, ["one two", "three"], speaker="SPEAKER_00")
    _add_speaker_name(
        db_session, ep, "SPEAKER_00", "Bob Inferred",
        inferred=True, confidence="HIGH", role=None,
    )

    rows = _per_episode_speaker(db_session)
    inferred = [r for r in rows if r["source"] == "inferred_high"]
    assert len(inferred) >= 1

    bob_rows = [r for r in inferred if r["display_name"] == "Bob Inferred"]
    assert len(bob_rows) == 1
    assert bob_rows[0]["role"] is None


def test_per_episode_speaker_excludes_role_other(db_session):
    """Confirmed rows with role='other' must be excluded entirely."""
    feed = _make_feed(db_session, "Feed PES C")
    ep = _make_episode(
        db_session, feed,
        published_at=datetime(2026, 3, 3, tzinfo=timezone.utc),
        duration_secs=60,
    )
    _add_segments(db_session, ep, ["noise filler"], speaker="SPEAKER_00")
    _add_speaker_name(
        db_session, ep, "SPEAKER_00", "Other Person",
        confirmed_by_user=True, role="other",
    )

    rows = _per_episode_speaker(db_session)
    confirmed = [r for r in rows if r["source"] == "confirmed"]
    assert all(r["role"] != "other" for r in confirmed)
    assert all(r["role"] is not None for r in confirmed)


# ---------------------------------------------------------------------------
# _episode_speaker_diff tests (TDD — Task 1.2)
# ---------------------------------------------------------------------------

from app.services.meta_analysis_aggregations import _episode_speaker_diff  # noqa: E402


def test_episode_speaker_diff_only_episodes_with_both_sides(db_session):
    """Episodes that have only hosts (or only guests) must NOT appear in
    the diff output. Episodes with both hosts AND guests must appear."""
    feed = _make_feed(db_session, "Feed ESD A")

    # Episode with only a host — should be excluded.
    ep_host_only = _make_episode(
        db_session, feed,
        published_at=datetime(2026, 4, 1, tzinfo=timezone.utc),
        duration_secs=120,
    )
    _add_segments(db_session, ep_host_only, ["one two three"], speaker="SPEAKER_00")
    _add_speaker_name(
        db_session, ep_host_only, "SPEAKER_00", "Alice Host",
        confirmed_by_user=True, role="host",
    )

    # Episode with both host and guest — should be included.
    ep_both = _make_episode(
        db_session, feed,
        published_at=datetime(2026, 4, 2, tzinfo=timezone.utc),
        duration_secs=180,
    )
    _add_segments(db_session, ep_both, ["host line one", "host line two"], speaker="SPEAKER_00")
    _add_segments(db_session, ep_both, ["guest line one"], speaker="SPEAKER_01")
    _add_speaker_name(
        db_session, ep_both, "SPEAKER_00", "Alice Host",
        confirmed_by_user=True, role="host",
    )
    _add_speaker_name(
        db_session, ep_both, "SPEAKER_01", "Bob Guest",
        confirmed_by_user=True, role="guest",
    )

    speakers = _per_episode_speaker(db_session)
    diff_rows = _episode_speaker_diff(speakers)

    episode_ids = {r["episode_id"] for r in diff_rows}
    assert ep_host_only.id not in episode_ids, "host-only episode must be excluded"
    assert ep_both.id in episode_ids, "episode with both host and guest must appear"

    both_row = next(r for r in diff_rows if r["episode_id"] == ep_both.id)
    assert both_row["host_count"] >= 1
    assert both_row["guest_count"] >= 1


def test_episode_speaker_diff_band_math(db_session):
    """Band math identities must hold for all diff rows:
        diff == guest_mean - host_mean
        band_lo == guest_min - host_max
        band_hi == guest_max - host_min
        band_lo <= diff <= band_hi
    """
    feed = _make_feed(db_session, "Feed ESD B")
    ep = _make_episode(
        db_session, feed,
        published_at=datetime(2026, 4, 10, tzinfo=timezone.utc),
        duration_secs=600,
    )

    # Host 1: 2 segments of 10s each → 20s = 1/3 min
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="SPEAKER_00",
        start_time=0.0, end_time=10.0, text="host one seg one",
    ))
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="SPEAKER_00",
        start_time=10.0, end_time=20.0, text="host one seg two",
    ))
    # Host 2: 1 segment of 30s
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="SPEAKER_01",
        start_time=20.0, end_time=50.0, text="host two seg one",
    ))
    # Guest 1: 1 segment of 60s
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="SPEAKER_02",
        start_time=50.0, end_time=110.0, text="guest one seg one",
    ))
    # Guest 2: 1 segment of 90s
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="SPEAKER_03",
        start_time=110.0, end_time=200.0, text="guest two seg one",
    ))
    db_session.commit()

    _add_speaker_name(
        db_session, ep, "SPEAKER_00", "Alice Host",
        confirmed_by_user=True, role="host",
    )
    _add_speaker_name(
        db_session, ep, "SPEAKER_01", "Carol Host",
        confirmed_by_user=True, role="host",
    )
    _add_speaker_name(
        db_session, ep, "SPEAKER_02", "Bob Guest",
        confirmed_by_user=True, role="guest",
    )
    _add_speaker_name(
        db_session, ep, "SPEAKER_03", "Dan Guest",
        confirmed_by_user=True, role="guest",
    )

    speakers = _per_episode_speaker(db_session)
    diff_rows = _episode_speaker_diff(speakers)

    ep_rows = [r for r in diff_rows if r["episode_id"] == ep.id]
    assert len(ep_rows) >= 1, "episode with multiple hosts + guests must appear"

    for r in ep_rows:
        assert r["diff"] == pytest.approx(r["guest_mean"] - r["host_mean"])
        assert r["band_lo"] == pytest.approx(r["guest_min"] - r["host_max"])
        assert r["band_hi"] == pytest.approx(r["guest_max"] - r["host_min"])
        # band_lo <= diff <= band_hi (with small float tolerance)
        assert r["band_lo"] <= r["diff"] + 1e-9
        assert r["diff"] <= r["band_hi"] + 1e-9


def test_episode_speaker_diff_inferred_uses_inheritance_then_heuristic(db_session):
    """Inferred-HIGH classification: inheritance from confirmed first,
    then 25%-of-episodes heuristic.

    Feed F: Alice is a confirmed host. In a separate inferred-HIGH episode,
    Alice should still be classified as host (inheritance).

    Feed G: no confirmed data. Bob appears in 1 out of 8 inferred episodes
    (12.5% < 25%) — should classify as guest. Dave appears in 3 out of 8
    (37.5% >= 25%) — should classify as host. The episode where both appear
    must show host_names=[Dave] and guest_names=[Bob].
    """
    # --- Feed F: confirmed Alice + inferred episode with Alice ---
    feed_f = _make_feed(db_session, "Feed ESD F")

    # Confirmed episode — primes _confirmed_role_map so Alice → host.
    ep_confirmed = _make_episode(
        db_session, feed_f,
        published_at=datetime(2026, 5, 1, tzinfo=timezone.utc),
        duration_secs=60,
    )
    _add_segments(db_session, ep_confirmed, ["confirmed host line"], speaker="SPEAKER_00")
    _add_speaker_name(
        db_session, ep_confirmed, "SPEAKER_00", "Alice",
        confirmed_by_user=True, role="host",
    )

    # Add 4 Alice-only inferred episodes so Zara's fraction is 1/5 = 20% < 25%.
    for i in range(4):
        ep_alice_only = _make_episode(
            db_session, feed_f,
            published_at=datetime(2026, 5, 10 + i, tzinfo=timezone.utc),
            duration_secs=60,
        )
        _add_segments(db_session, ep_alice_only, [f"alice only line {i}"], speaker="SPEAKER_00")
        _add_speaker_name(
            db_session, ep_alice_only, "SPEAKER_00", "Alice",
            inferred=True, confidence="HIGH", role=None,
        )

    # Inferred-HIGH episode with Alice (host via inheritance) and Zara (guest via heuristic).
    # Alice appears in all 5 inferred episodes (100% >= 25% → host if no confirmed entry, but
    # Alice IS in confirmed_map → inheritance wins regardless).
    # Zara appears in only 1 of 5 inferred episodes (20% < 25% → guest by heuristic).
    ep_inferred_f = _make_episode(
        db_session, feed_f,
        published_at=datetime(2026, 5, 2, tzinfo=timezone.utc),
        duration_secs=120,
    )
    _add_segments(db_session, ep_inferred_f, ["alice inferred line"], speaker="SPEAKER_00")
    _add_segments(db_session, ep_inferred_f, ["guest inferred line"], speaker="SPEAKER_01")
    _add_speaker_name(
        db_session, ep_inferred_f, "SPEAKER_00", "Alice",
        inferred=True, confidence="HIGH", role=None,
    )
    _add_speaker_name(
        db_session, ep_inferred_f, "SPEAKER_01", "Zara Guest",
        inferred=True, confidence="HIGH", role=None,
    )

    # --- Feed G: no confirmed data; heuristic only ---
    feed_g = _make_feed(db_session, "Feed ESD G")

    # Seed 8 inferred episodes in feed G.
    # Dave appears in 3 of 8 (37.5%) → host.
    # Bob appears in 1 of 8 (12.5%) → guest.
    # The last episode (ep_g_both) has both Dave and Bob → must produce a diff row.
    ep_g_episodes = []
    for i in range(7):
        pub = datetime(2026, 5, 1 + i, tzinfo=timezone.utc)
        ep_g = _make_episode(db_session, feed_g, published_at=pub, duration_secs=60)
        ep_g_episodes.append(ep_g)
        _add_segments(db_session, ep_g, [f"dave line {i}"], speaker="SPEAKER_00")
        _add_speaker_name(
            db_session, ep_g, "SPEAKER_00", "Dave",
            inferred=True, confidence="HIGH", role=None,
        )
        if i < 2:
            # Dave appears in ep_g_episodes[0] and [1] (indices 0,1)
            # plus ep_g_both below → 3 total out of 8.
            pass

    # ep_g_both: Dave AND Bob both appear. Dave=host (3/8), Bob=guest (1/8).
    ep_g_both = _make_episode(
        db_session, feed_g,
        published_at=datetime(2026, 5, 8, tzinfo=timezone.utc),
        duration_secs=120,
    )
    ep_g_episodes.append(ep_g_both)
    _add_segments(db_session, ep_g_both, ["dave line final"], speaker="SPEAKER_00")
    _add_segments(db_session, ep_g_both, ["bob line only"], speaker="SPEAKER_01")
    _add_speaker_name(
        db_session, ep_g_both, "SPEAKER_00", "Dave",
        inferred=True, confidence="HIGH", role=None,
    )
    _add_speaker_name(
        db_session, ep_g_both, "SPEAKER_01", "Bob",
        inferred=True, confidence="HIGH", role=None,
    )

    speakers = _per_episode_speaker(db_session)
    diff_rows = _episode_speaker_diff(speakers)

    # --- Feed F inferred episode check ---
    f_inferred_rows = [
        r for r in diff_rows
        if r["episode_id"] == ep_inferred_f.id and r["source"] == "inferred_high"
    ]
    assert len(f_inferred_rows) == 1, "inferred episode in feed F must produce a diff row"
    f_row = f_inferred_rows[0]
    assert "Alice" in f_row["host_names"], (
        "Alice should be classified as host via inheritance from confirmed map"
    )
    assert "Zara Guest" in f_row["guest_names"], (
        "Zara Guest has no confirmed entry — must fall back to heuristic (guest, < 25%)"
    )

    # --- Feed G diff row check ---
    g_both_rows = [
        r for r in diff_rows
        if r["episode_id"] == ep_g_both.id and r["source"] == "inferred_high"
    ]
    assert len(g_both_rows) == 1, "ep_g_both must produce exactly one diff row"
    g_row = g_both_rows[0]
    assert "Dave" in g_row["host_names"], "Dave (3/8 = 37.5% >= 25%) should be host"
    assert "Bob" in g_row["guest_names"], "Bob (1/8 = 12.5% < 25%) should be guest"
