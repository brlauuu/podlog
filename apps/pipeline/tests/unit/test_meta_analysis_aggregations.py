"""Unit tests for app.services.meta_analysis_aggregations (#795).

Mirrors the cases in tests/integration/services/test_meta_analysis.py against
a fake SQLAlchemy Session so CI's `pytest tests/unit --cov=app` measurement
reflects the actual coverage of the aggregation helpers. Pure (non-DB)
helpers are tested directly; DB-driven helpers use a queue-based fake
Session that returns canned row tuples in the order the function issues
its queries.
"""
from __future__ import annotations

from datetime import datetime
from types import SimpleNamespace
from typing import Any

import pytest

from app.services import meta_analysis_aggregations as agg


# ---------- _FakeSession ----------


class _FakeResult:
    """Stand-in for SQLAlchemy's Result; supports .scalars().all() and .all()."""

    def __init__(self, rows: list):
        self._rows = rows

    def all(self) -> list:
        return self._rows

    def scalars(self) -> "_FakeResult":
        return self


class _FakeSession:
    """Returns canned rows in FIFO order for each db.execute() call.

    The aggregation functions issue their queries in a deterministic order,
    so the test provides a list of expected returns. Each execute() pops
    the next one.
    """

    def __init__(self, query_returns: list[list]):
        # Wrap each canned list as a _FakeResult so both .all() and
        # .scalars().all() paths work transparently.
        self._returns = [_FakeResult(rows) for rows in query_returns]
        self._call_count = 0

    def execute(self, _stmt: Any) -> _FakeResult:
        if self._call_count >= len(self._returns):
            raise AssertionError(
                f"Unexpected execute() call #{self._call_count + 1}; "
                f"only {len(self._returns)} canned returns provided."
            )
        result = self._returns[self._call_count]
        self._call_count += 1
        return result


# ---------- pure helpers: _confirmed_role_map ----------


class TestConfirmedRoleMap:
    def test_skips_non_confirmed_rows(self):
        speakers = [
            {"source": "inferred_high", "feed_id": "f1", "display_name": "X", "role": None},
        ]
        assert agg._confirmed_role_map(speakers) == {}

    def test_single_host_vote(self):
        speakers = [
            {"source": "confirmed", "feed_id": "f1", "display_name": "Alice", "role": "host"},
        ]
        assert agg._confirmed_role_map(speakers) == {("f1", "Alice"): True}

    def test_single_guest_vote(self):
        speakers = [
            {"source": "confirmed", "feed_id": "f1", "display_name": "Bob", "role": "guest"},
        ]
        assert agg._confirmed_role_map(speakers) == {("f1", "Bob"): False}

    def test_majority_wins_host(self):
        # Alice: 2 host votes, 1 guest → host
        speakers = [
            {"source": "confirmed", "feed_id": "f1", "display_name": "Alice", "role": "host"},
            {"source": "confirmed", "feed_id": "f1", "display_name": "Alice", "role": "host"},
            {"source": "confirmed", "feed_id": "f1", "display_name": "Alice", "role": "guest"},
        ]
        assert agg._confirmed_role_map(speakers) == {("f1", "Alice"): True}

    def test_majority_wins_guest(self):
        speakers = [
            {"source": "confirmed", "feed_id": "f1", "display_name": "Carol", "role": "guest"},
            {"source": "confirmed", "feed_id": "f1", "display_name": "Carol", "role": "guest"},
            {"source": "confirmed", "feed_id": "f1", "display_name": "Carol", "role": "host"},
        ]
        assert agg._confirmed_role_map(speakers) == {("f1", "Carol"): False}

    def test_ties_break_toward_host(self):
        speakers = [
            {"source": "confirmed", "feed_id": "f1", "display_name": "Dan", "role": "host"},
            {"source": "confirmed", "feed_id": "f1", "display_name": "Dan", "role": "guest"},
        ]
        # 1 vs 1 → host (per docstring)
        assert agg._confirmed_role_map(speakers) == {("f1", "Dan"): True}

    def test_unrecognized_role_does_not_vote(self):
        # role="other" is ignored entirely; entry initialises but stays [0,0]
        speakers = [
            {"source": "confirmed", "feed_id": "f1", "display_name": "Eve", "role": "other"},
        ]
        # No host or guest vote → tie at 0,0 → defaults to host=True
        assert agg._confirmed_role_map(speakers) == {("f1", "Eve"): True}


# ---------- pure helpers: _episode_speaker_diff ----------


def _make_speaker_row(
    *,
    feed_id="f1",
    feed_title="Show",
    episode_id="ep1",
    episode_title="Ep",
    published_at="2026-06-01T10:00:00",
    display_name="Alice",
    role=None,
    source="confirmed",
    minutes=10.0,
    words=1500,
):
    return {
        "feed_id": feed_id,
        "feed_title": feed_title,
        "episode_id": episode_id,
        "episode_title": episode_title,
        "published_at": published_at,
        "display_name": display_name,
        "role": role,
        "source": source,
        "minutes": minutes,
        "words": words,
    }


class TestEpisodeSpeakerDiff:
    def test_empty_input_returns_empty(self):
        assert agg._episode_speaker_diff([]) == []

    def test_episode_with_only_hosts_is_excluded(self):
        speakers = [
            _make_speaker_row(display_name="Alice", role="host"),
            _make_speaker_row(display_name="Bob", role="host"),
        ]
        assert agg._episode_speaker_diff(speakers) == []

    def test_episode_with_only_guests_is_excluded(self):
        speakers = [
            _make_speaker_row(display_name="Alice", role="guest"),
        ]
        assert agg._episode_speaker_diff(speakers) == []

    def test_confirmed_host_plus_guest_yields_one_row(self):
        speakers = [
            _make_speaker_row(display_name="Alice", role="host", minutes=30.0),
            _make_speaker_row(display_name="Bob", role="guest", minutes=15.0),
        ]
        rows = agg._episode_speaker_diff(speakers)
        assert len(rows) == 1
        row = rows[0]
        assert row["feed_id"] == "f1"
        assert row["episode_id"] == "ep1"
        assert row["source"] == "confirmed"
        assert row["host_mean"] == 30.0
        assert row["guest_mean"] == 15.0
        assert row["diff"] == -15.0  # guest_mean - host_mean
        assert row["host_count"] == 1
        assert row["guest_count"] == 1
        assert row["host_names"] == ["Alice"]
        assert row["guest_names"] == ["Bob"]
        assert row["band_lo"] == 15.0 - 30.0  # guest_min - host_max
        assert row["band_hi"] == 15.0 - 30.0  # guest_max - host_min

    def test_multiple_hosts_and_guests_compute_band(self):
        speakers = [
            _make_speaker_row(display_name="HostA", role="host", minutes=20.0),
            _make_speaker_row(display_name="HostB", role="host", minutes=40.0),
            _make_speaker_row(display_name="GuestA", role="guest", minutes=10.0),
            _make_speaker_row(display_name="GuestB", role="guest", minutes=30.0),
        ]
        rows = agg._episode_speaker_diff(speakers)
        assert len(rows) == 1
        row = rows[0]
        assert row["host_min"] == 20.0
        assert row["host_max"] == 40.0
        assert row["host_mean"] == 30.0
        assert row["guest_min"] == 10.0
        assert row["guest_max"] == 30.0
        assert row["guest_mean"] == 20.0
        assert row["diff"] == -10.0
        assert row["band_lo"] == 10.0 - 40.0  # guest_min - host_max = -30
        assert row["band_hi"] == 30.0 - 20.0  # guest_max - host_min = 10
        assert row["host_names"] == ["HostA", "HostB"]  # sorted unique
        assert row["guest_names"] == ["GuestA", "GuestB"]

    def test_inferred_high_inherits_from_confirmed_map(self):
        # Confirmed row in a prior episode marks Alice as host.
        # Inferred row in a different episode should inherit that classification.
        # Carol has no confirmed precedent → heuristic. Pad the inferred feed
        # with 5 more solo episodes so Carol's share (1/6 = 16.7%) is below
        # the 25% host threshold and she falls to guest.
        speakers = [
            _make_speaker_row(episode_id="ep_confirmed", display_name="Alice",
                              role="host", source="confirmed", minutes=20.0),
            _make_speaker_row(episode_id="ep_confirmed", display_name="Bob",
                              role="guest", source="confirmed", minutes=10.0),
            _make_speaker_row(episode_id="ep_inferred", display_name="Alice",
                              source="inferred_high", minutes=25.0),
            _make_speaker_row(episode_id="ep_inferred", display_name="Carol",
                              source="inferred_high", minutes=15.0),
        ]
        for i in range(5):
            speakers.append(_make_speaker_row(
                episode_id=f"ep_pad{i}", display_name=f"Pad{i}",
                source="inferred_high", minutes=5.0,
            ))
        rows = agg._episode_speaker_diff(speakers)
        # One confirmed row + one inferred row (for ep_inferred)
        sources = {r["source"] for r in rows}
        assert sources == {"confirmed", "inferred_high"}
        inferred = next(r for r in rows if r["source"] == "inferred_high"
                        and r["episode_id"] == "ep_inferred")
        # Alice inherited host status → host_mean=25, Carol fell to guest=15
        assert inferred["host_names"] == ["Alice"]
        assert inferred["guest_names"] == ["Carol"]

    def test_inferred_high_heuristic_25pct_threshold(self):
        # Alice in 4 of 8 inferred-feed episodes → 50% → host.
        # Bob in only ep1 → 1/8 = 12.5% → guest.
        # ep1 should have Alice host + Bob guest → included.
        rows = []
        # Alice appears in ep1..ep4
        for i in range(1, 5):
            rows.append(_make_speaker_row(
                episode_id=f"ep{i}", display_name="Alice",
                source="inferred_high", minutes=20.0,
            ))
        # Bob only in ep1
        rows.append(_make_speaker_row(
            episode_id="ep1", display_name="Bob",
            source="inferred_high", minutes=10.0,
        ))
        # Pad 4 more solo episodes with unique speakers (drag down ratios).
        for i in range(5, 9):
            rows.append(_make_speaker_row(
                episode_id=f"ep{i}", display_name=f"Filler{i}",
                source="inferred_high", minutes=5.0,
            ))
        result = agg._episode_speaker_diff(rows)
        ep1 = next((r for r in result if r["episode_id"] == "ep1"), None)
        assert ep1 is not None
        assert ep1["host_names"] == ["Alice"]
        assert ep1["guest_names"] == ["Bob"]

    def test_inferred_high_falls_back_to_heuristic(self):
        # Build a feed of 10 inferred episodes. Alice appears in 5 → 50% → host.
        # Bob appears in 1 → 10% → guest. Episode 1 has both.
        rows = []
        for i in range(1, 6):
            rows.append(_make_speaker_row(
                episode_id=f"ep{i}", display_name="Alice",
                source="inferred_high", minutes=20.0,
            ))
        rows.append(_make_speaker_row(
            episode_id="ep1", display_name="Bob",
            source="inferred_high", minutes=10.0,
        ))
        # Pad with 5 more episodes with neither Alice nor Bob to set the
        # feed-total denominator
        for i in range(6, 11):
            rows.append(_make_speaker_row(
                episode_id=f"ep{i}", display_name="Filler",
                source="inferred_high", minutes=5.0,
            ))
        result = agg._episode_speaker_diff(rows)
        ep1 = next((r for r in result if r["episode_id"] == "ep1"), None)
        assert ep1 is not None
        assert ep1["source"] == "inferred_high"
        assert ep1["host_names"] == ["Alice"]
        assert ep1["guest_names"] == ["Bob"]

    def test_unknown_source_is_skipped(self):
        # A row with neither 'confirmed' nor 'inferred_high' source is dropped
        speakers = [
            _make_speaker_row(display_name="Alice", role="host"),
            _make_speaker_row(display_name="Bob", role="guest"),
            _make_speaker_row(display_name="Mystery", role=None, source="other"),
        ]
        rows = agg._episode_speaker_diff(speakers)
        assert len(rows) == 1  # mystery row dropped
        all_names = rows[0]["host_names"] + rows[0]["guest_names"]
        assert "Mystery" not in all_names

    def test_output_sorted_by_feed_title_then_published_at_then_source(self):
        speakers = [
            _make_speaker_row(feed_id="f2", feed_title="ZShow", episode_id="epZ",
                              published_at="2026-01-01T00:00:00",
                              display_name="A", role="host"),
            _make_speaker_row(feed_id="f2", feed_title="ZShow", episode_id="epZ",
                              published_at="2026-01-01T00:00:00",
                              display_name="B", role="guest"),
            _make_speaker_row(feed_id="f1", feed_title="AShow", episode_id="epA",
                              published_at="2026-06-01T00:00:00",
                              display_name="C", role="host"),
            _make_speaker_row(feed_id="f1", feed_title="AShow", episode_id="epA",
                              published_at="2026-06-01T00:00:00",
                              display_name="D", role="guest"),
        ]
        rows = agg._episode_speaker_diff(speakers)
        # AShow sorts before ZShow alphabetically
        assert [r["feed_title"] for r in rows] == ["AShow", "ZShow"]


# ---------- pure helpers: _is_denylisted_inferred_name ----------


class TestIsDenylistedInferredName:
    def test_empty_string_is_denylisted(self):
        assert agg._is_denylisted_inferred_name("") is True

    def test_none_is_denylisted(self):
        assert agg._is_denylisted_inferred_name(None) is True

    def test_platform_names_are_denylisted(self):
        for name in ("Twitter", "LinkedIn", "Spotify", "YouTube", "Apple"):
            assert agg._is_denylisted_inferred_name(name) is True, name

    def test_real_person_name_passes_through(self):
        assert agg._is_denylisted_inferred_name("Marko Papic") is False

    def test_denylist_is_normalized(self):
        # normalize_name should canonicalize "twitter" -> matches "Twitter" entry
        assert agg._is_denylisted_inferred_name("twitter") is True


# ---------- pure helpers: _merge_inferred_fragments ----------


class TestMergeInferredFragments:
    def test_confirmed_rows_passthrough(self):
        rows = [_make_speaker_row(source="confirmed", role="host")]
        result = agg._merge_inferred_fragments(rows)
        assert result == rows

    def test_fragment_merges_into_longest_sibling(self):
        # "Marko" should fold into "Marko Papic" within the same feed.
        rows = [
            _make_speaker_row(episode_id="ep1", display_name="Marko",
                              source="inferred_high", minutes=5.0, words=500),
            _make_speaker_row(episode_id="ep1", display_name="Marko Papic",
                              source="inferred_high", minutes=20.0, words=2000),
        ]
        result = agg._merge_inferred_fragments(rows)
        assert len(result) == 1
        assert result[0]["display_name"] == "Marko Papic"
        assert result[0]["minutes"] == 25.0
        assert result[0]["words"] == 2500

    def test_no_sibling_returns_row_unchanged(self):
        rows = [
            _make_speaker_row(display_name="Solo Person",
                              source="inferred_high", minutes=10.0),
        ]
        result = agg._merge_inferred_fragments(rows)
        assert len(result) == 1
        assert result[0]["display_name"] == "Solo Person"

    def test_different_feeds_do_not_cross_merge(self):
        rows = [
            _make_speaker_row(feed_id="f1", episode_id="e1", display_name="Alex",
                              source="inferred_high", minutes=5.0, words=100),
            _make_speaker_row(feed_id="f2", episode_id="e2", display_name="Alex Smith",
                              source="inferred_high", minutes=10.0, words=200),
        ]
        result = agg._merge_inferred_fragments(rows)
        # Different feeds → no merge happens
        assert len(result) == 2
        names = sorted(r["display_name"] for r in result)
        assert names == ["Alex", "Alex Smith"]

    def test_empty_display_name_is_skipped(self):
        rows = [
            _make_speaker_row(display_name="", source="inferred_high"),
            _make_speaker_row(display_name="Alice", source="inferred_high", minutes=10.0),
        ]
        result = agg._merge_inferred_fragments(rows)
        # Empty-name row passes through unchanged; Alice has no fragment to merge
        assert len(result) == 2


# ---------- pure helpers: _count_turns (already partially covered) ----------


class TestCountTurnsAdditional:
    def test_count_turns_handles_unsorted_input(self):
        # Existing tests in test_meta_analysis_service.py cover the basic
        # cases; we add this to exercise the sort-by-start path explicitly.
        segs = [
            SimpleNamespace(start_time=10.0, speaker_label="B"),
            SimpleNamespace(start_time=0.0, speaker_label="A"),
            SimpleNamespace(start_time=20.0, speaker_label="A"),
        ]
        # Sorted: A(0), B(10), A(20) → 3 turns
        assert agg._count_turns(segs) == 3


# ---------- pure helpers: _identify_feed_host ----------


class TestIdentifyFeedHost:
    def _make_feed(self, *, id="f1", podcast_persons=None,
                   itunes_owner_name=None, itunes_author=None):
        return SimpleNamespace(
            id=id,
            podcast_persons=podcast_persons,
            itunes_owner_name=itunes_owner_name,
            itunes_author=itunes_author,
        )

    def test_feed_speaker_cache_takes_priority(self):
        feed = self._make_feed(
            podcast_persons=[{"role": "host", "name": "From PodcastIndex"}],
            itunes_owner_name="From iTunes",
        )
        result = agg._identify_feed_host(feed, {"f1": "From FSC"})
        assert result == "From FSC"

    def test_podcast_persons_host_role_used_when_no_fsc(self):
        feed = self._make_feed(
            podcast_persons=[
                {"role": "guest", "name": "Bob"},
                {"role": "host", "name": "Alice"},
            ],
        )
        assert agg._identify_feed_host(feed, {}) == "Alice"

    def test_case_insensitive_role_match(self):
        feed = self._make_feed(
            podcast_persons=[{"role": "HOST", "name": "Alice"}],
        )
        assert agg._identify_feed_host(feed, {}) == "Alice"

    def test_falls_back_to_itunes_owner(self):
        feed = self._make_feed(itunes_owner_name="iTunes Owner")
        assert agg._identify_feed_host(feed, {}) == "iTunes Owner"

    def test_falls_back_to_itunes_author(self):
        feed = self._make_feed(itunes_author="iTunes Author")
        assert agg._identify_feed_host(feed, {}) == "iTunes Author"

    def test_returns_none_when_nothing_set(self):
        feed = self._make_feed()
        assert agg._identify_feed_host(feed, {}) is None

    def test_podcast_persons_skips_non_dict_entries(self):
        feed = self._make_feed(
            podcast_persons=["not a dict", {"role": "host", "name": "Alice"}],
        )
        assert agg._identify_feed_host(feed, {}) == "Alice"

    def test_podcast_persons_skips_host_entry_with_no_name(self):
        feed = self._make_feed(
            podcast_persons=[{"role": "host"}, {"role": "host", "name": "Alice"}],
        )
        assert agg._identify_feed_host(feed, {}) == "Alice"


# ---------- pure helpers: _host_speaker_label_for_episode ----------


class TestHostSpeakerLabelForEpisode:
    def test_returns_none_when_host_norm_empty(self):
        assert agg._host_speaker_label_for_episode("ep1", "", {}) is None
        assert agg._host_speaker_label_for_episode("ep1", "   ", {}) is None

    def test_returns_none_when_no_speaker_names_for_episode(self):
        assert agg._host_speaker_label_for_episode("ep1", "Alice", {}) is None

    def test_matches_confirmed_speaker_by_normalized_name(self):
        sn = SimpleNamespace(
            confirmed_by_user=True, confidence=None,
            display_name="Alice Smith", speaker_label="SPEAKER_00",
        )
        sn_by_ep = {"ep1": [sn]}
        assert agg._host_speaker_label_for_episode("ep1", "Alice Smith", sn_by_ep) \
            == "SPEAKER_00"

    def test_matches_high_confidence_speaker(self):
        sn = SimpleNamespace(
            confirmed_by_user=False, confidence="HIGH",
            display_name="Alice", speaker_label="SPEAKER_01",
        )
        sn_by_ep = {"ep1": [sn]}
        assert agg._host_speaker_label_for_episode("ep1", "Alice", sn_by_ep) \
            == "SPEAKER_01"

    def test_skips_unconfirmed_low_confidence_speakers(self):
        sn = SimpleNamespace(
            confirmed_by_user=False, confidence="LOW",
            display_name="Alice", speaker_label="SPEAKER_02",
        )
        sn_by_ep = {"ep1": [sn]}
        assert agg._host_speaker_label_for_episode("ep1", "Alice", sn_by_ep) is None


# ---------- DB-driven: _per_episode ----------


def _ep_row(*, id="ep1", feed_id="f1", published_at=None, duration_secs=600,
            fireworks_stt_cost_usd=None, transcribe_duration_secs=None,
            diarize_duration_secs=None, inference_provider_used=None):
    return SimpleNamespace(
        id=id, feed_id=feed_id, published_at=published_at,
        duration_secs=duration_secs,
        fireworks_stt_cost_usd=fireworks_stt_cost_usd,
        transcribe_duration_secs=transcribe_duration_secs,
        diarize_duration_secs=diarize_duration_secs,
        inference_provider_used=inference_provider_used,
    )


def _seg_row(*, episode_id="ep1", text="hello world",
             speaker_label="SPEAKER_00", start_time=0.0, end_time=2.0):
    return SimpleNamespace(
        episode_id=episode_id, text=text, speaker_label=speaker_label,
        start_time=start_time, end_time=end_time,
    )


def _chunk_row(*, episode_id="ep1", text="chunk text"):
    return SimpleNamespace(episode_id=episode_id, text=text)


class TestPerEpisode:
    def test_aggregates_one_episode(self):
        eps = [_ep_row(id="ep1", feed_id="f1",
                       published_at=datetime(2026, 6, 1, 10, 0, 0),
                       duration_secs=120)]
        segs = [
            _seg_row(episode_id="ep1", text="hello world",
                     speaker_label="SPEAKER_00", start_time=0.0, end_time=2.0),
            _seg_row(episode_id="ep1", text="another line here",
                     speaker_label="SPEAKER_01", start_time=2.0, end_time=5.0),
        ]
        chunks = [_chunk_row(episode_id="ep1", text="some chunk text")]
        db = _FakeSession([eps, segs, chunks])
        result = agg._per_episode(db)

        assert len(result) == 1
        row = result[0]
        assert row["episode_id"] == "ep1"
        assert row["feed_id"] == "f1"
        assert row["published_at"] == "2026-06-01T10:00:00"
        assert row["duration_secs"] == 120
        assert row["word_count"] == 5  # "hello world" + "another line here"
        assert row["speaker_count"] == 2
        # turn_count: A then B = 2 turns
        assert row["turn_count"] == 2
        # wpm = 5 words / (120/60) = 2.5
        assert row["wpm"] == 2.5
        assert row["host_share"] is None  # filled by coverage block

    def test_published_at_none_yields_none(self):
        eps = [_ep_row(id="ep1", published_at=None)]
        db = _FakeSession([eps, [], []])
        result = agg._per_episode(db)
        assert result[0]["published_at"] is None

    def test_fireworks_cost_passes_through_when_set(self):
        eps = [_ep_row(id="ep1", fireworks_stt_cost_usd=0.0042)]
        db = _FakeSession([eps, [], []])
        result = agg._per_episode(db)
        assert result[0]["fireworks_cost_usd"] == pytest.approx(0.0042)

    def test_fireworks_cost_none_passes_through_as_none(self):
        eps = [_ep_row(id="ep1", fireworks_stt_cost_usd=None)]
        db = _FakeSession([eps, [], []])
        result = agg._per_episode(db)
        assert result[0]["fireworks_cost_usd"] is None

    def test_no_segments_zero_words(self):
        eps = [_ep_row(id="ep1", duration_secs=600)]
        db = _FakeSession([eps, [], []])
        result = agg._per_episode(db)
        assert result[0]["word_count"] == 0
        assert result[0]["speaker_count"] == 0
        assert result[0]["wpm"] == 0.0

    def test_speaker_label_none_does_not_count_as_speaker(self):
        eps = [_ep_row(id="ep1")]
        segs = [
            _seg_row(episode_id="ep1", speaker_label=None, text="words here"),
            _seg_row(episode_id="ep1", speaker_label="SPEAKER_00", text="more words"),
        ]
        db = _FakeSession([eps, segs, []])
        result = agg._per_episode(db)
        # Only SPEAKER_00 counted; None excluded
        assert result[0]["speaker_count"] == 1


# ---------- DB-driven: _per_speaker ----------


def _sn_row(*, episode_id="ep1", speaker_label="SPEAKER_00", display_name="Alice"):
    return SimpleNamespace(
        episode_id=episode_id, speaker_label=speaker_label,
        display_name=display_name,
    )


def _ep_idx_row(*, id="ep1", feed_id="f1"):
    return SimpleNamespace(id=id, feed_id=feed_id)


class TestPerSpeaker:
    def test_aggregates_one_speaker_across_one_episode(self):
        sn = [_sn_row(episode_id="ep1", speaker_label="SPEAKER_00",
                      display_name="Alice")]
        ep = [_ep_idx_row(id="ep1", feed_id="f1")]
        segs = [
            _seg_row(episode_id="ep1", speaker_label="SPEAKER_00",
                     text="hello world", start_time=0.0, end_time=10.0),
            _seg_row(episode_id="ep1", speaker_label="SPEAKER_00",
                     text="more words here", start_time=10.0, end_time=20.0),
        ]
        db = _FakeSession([sn, ep, segs])
        result = agg._per_speaker(db)

        assert len(result) == 1
        row = result[0]
        assert row["speaker_display_name"] == "Alice"
        assert row["feed_id"] == "f1"
        assert row["total_words"] == 5
        assert row["total_seconds"] == 20.0
        assert row["episode_count"] == 1
        # All same speaker → 1 turn
        assert row["turn_count"] == 1

    def test_skips_segment_for_unknown_episode(self):
        sn = [_sn_row()]
        ep: list = []  # no episodes in ep_feed
        segs = [_seg_row(text="ignored")]
        db = _FakeSession([sn, ep, segs])
        result = agg._per_speaker(db)
        assert result == []

    def test_skips_unknown_speaker_label(self):
        sn = [_sn_row(speaker_label="SPEAKER_00", display_name="Alice")]
        ep = [_ep_idx_row()]
        segs = [
            _seg_row(speaker_label="SPEAKER_99", text="not labelled"),
            _seg_row(speaker_label="SPEAKER_00", text="counted here"),
        ]
        db = _FakeSession([sn, ep, segs])
        result = agg._per_speaker(db)
        assert len(result) == 1
        assert result[0]["total_words"] == 2

    def test_turn_count_grows_with_alternating_speakers(self):
        sn = [
            _sn_row(speaker_label="SPEAKER_00", display_name="Alice"),
            _sn_row(speaker_label="SPEAKER_01", display_name="Bob"),
        ]
        ep = [_ep_idx_row()]
        segs = [
            _seg_row(speaker_label="SPEAKER_00", text="a", start_time=0.0, end_time=1.0),
            _seg_row(speaker_label="SPEAKER_01", text="b", start_time=1.0, end_time=2.0),
            _seg_row(speaker_label="SPEAKER_00", text="c", start_time=2.0, end_time=3.0),
            _seg_row(speaker_label="SPEAKER_00", text="d", start_time=3.0, end_time=4.0),
        ]
        db = _FakeSession([sn, ep, segs])
        result = agg._per_speaker(db)
        result_by_name = {r["speaker_display_name"]: r for r in result}
        # Alice: enters, hands off to Bob, takes over again → 2 turns
        assert result_by_name["Alice"]["turn_count"] == 2
        # Bob: 1 turn
        assert result_by_name["Bob"]["turn_count"] == 1

    def test_wpm_computed_correctly(self):
        sn = [_sn_row()]
        ep = [_ep_idx_row()]
        # 6 words across 60 seconds → 6 wpm
        segs = [_seg_row(text="one two three four five six",
                          start_time=0.0, end_time=60.0)]
        db = _FakeSession([sn, ep, segs])
        result = agg._per_speaker(db)
        assert result[0]["wpm"] == 6.0

    def test_output_sorted_by_feed_then_normalized_name(self):
        sn = [
            _sn_row(episode_id="ep1", speaker_label="SPEAKER_00", display_name="Zoe"),
            _sn_row(episode_id="ep1", speaker_label="SPEAKER_01", display_name="Alice"),
        ]
        ep = [_ep_idx_row(id="ep1", feed_id="f1")]
        segs = [
            _seg_row(episode_id="ep1", speaker_label="SPEAKER_00",
                     text="z", start_time=0.0, end_time=1.0),
            _seg_row(episode_id="ep1", speaker_label="SPEAKER_01",
                     text="a", start_time=1.0, end_time=2.0),
        ]
        db = _FakeSession([sn, ep, segs])
        result = agg._per_speaker(db)
        # normalized: "alice" < "zoe"
        assert [r["speaker_display_name"] for r in result] == ["Alice", "Zoe"]


# ---------- DB-driven: _per_episode_speaker ----------


def _joined_row(*, feed_id="f1", feed_title="Show", episode_id="ep1",
                 episode_title="Ep", published_at=None,
                 display_name="Alice", role="host", source="confirmed",
                 start_time=0.0, end_time=60.0, text="hello world"):
    return SimpleNamespace(
        feed_id=feed_id, feed_title=feed_title,
        episode_id=episode_id, episode_title=episode_title,
        published_at=published_at,
        display_name=display_name, role=role, source=source,
        start_time=start_time, end_time=end_time, text=text,
    )


class TestPerEpisodeSpeaker:
    def test_aggregates_minutes_and_words_per_speaker_episode(self):
        rows = [
            _joined_row(start_time=0.0, end_time=60.0, text="hello world"),
            _joined_row(start_time=60.0, end_time=120.0, text="more"),
        ]
        db = _FakeSession([rows])
        result = agg._per_episode_speaker(db)
        assert len(result) == 1
        row = result[0]
        assert row["minutes"] == pytest.approx(2.0)  # 120s / 60
        assert row["words"] == 3  # "hello world" + "more"
        assert row["display_name"] == "Alice"
        assert row["source"] == "confirmed"

    def test_published_at_isoformatted(self):
        rows = [_joined_row(published_at=datetime(2026, 6, 1, 10, 0, 0))]
        db = _FakeSession([rows])
        result = agg._per_episode_speaker(db)
        assert result[0]["published_at"] == "2026-06-01T10:00:00"

    def test_published_at_none(self):
        rows = [_joined_row(published_at=None)]
        db = _FakeSession([rows])
        result = agg._per_episode_speaker(db)
        assert result[0]["published_at"] is None

    def test_text_none_does_not_crash_word_count(self):
        # The aggregation guards against text=None via `if s.text else 0`
        rows = [_joined_row(text=None, end_time=30.0)]
        db = _FakeSession([rows])
        result = agg._per_episode_speaker(db)
        assert result[0]["words"] == 0

    def test_drops_denylisted_inferred_names(self):
        rows = [
            _joined_row(display_name="Twitter", source="inferred_high"),
            _joined_row(display_name="Marko Papic", source="inferred_high"),
        ]
        db = _FakeSession([rows])
        result = agg._per_episode_speaker(db)
        names = [r["display_name"] for r in result]
        assert "Twitter" not in names
        assert "Marko Papic" in names

    def test_confirmed_rows_not_dropped_even_if_in_denylist(self):
        # Confirmed entries bypass the denylist
        rows = [_joined_row(display_name="Spotify", source="confirmed")]
        db = _FakeSession([rows])
        result = agg._per_episode_speaker(db)
        assert any(r["display_name"] == "Spotify" for r in result)

    def test_output_sorted_by_feed_pub_speaker_source(self):
        rows = [
            _joined_row(feed_title="ZShow", display_name="A", episode_id="e1"),
            _joined_row(feed_title="AShow", display_name="B", episode_id="e2"),
        ]
        db = _FakeSession([rows])
        result = agg._per_episode_speaker(db)
        assert [r["feed_title"] for r in result] == ["AShow", "ZShow"]


# ---------- pure helpers: _count_tokens (defensive coverage) ----------


class TestCountTokens:
    def test_empty_returns_zero(self):
        assert agg._count_tokens("") == 0

    def test_basic_text_returns_positive(self):
        # Don't pin the value; tiktoken counts may shift across versions.
        # Just assert it's > 0 for non-empty text when the encoder is loaded.
        if agg._TOKENIZER_AVAILABLE:
            assert agg._count_tokens("Hello, world!") > 0
