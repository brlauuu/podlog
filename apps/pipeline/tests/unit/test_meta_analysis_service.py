"""Unit tests for app.services.meta_analysis (#556).

Focus on pure helpers and stale-flag orchestration. DB-heavy aggregates
(_per_episode, _per_speaker, _coverage_and_host_share) are exercised by
integration tests and covered indirectly through compute_snapshot wiring.
"""
from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from app.services import meta_analysis as svc


class TestCountTurns:
    def test_empty_returns_zero(self):
        assert svc._count_turns([]) == 0

    def test_single_segment_is_one_turn(self):
        segs = [SimpleNamespace(start_time=0.0, speaker_label="A")]
        assert svc._count_turns(segs) == 1

    def test_counts_speaker_changes(self):
        segs = [
            SimpleNamespace(start_time=0.0, speaker_label="A"),
            SimpleNamespace(start_time=1.0, speaker_label="A"),
            SimpleNamespace(start_time=2.0, speaker_label="B"),
            SimpleNamespace(start_time=3.0, speaker_label="A"),
        ]
        # A (start) -> A (no change) -> B (change) -> A (change) = 3 turns
        assert svc._count_turns(segs) == 3

    def test_sorts_by_start_time_before_counting(self):
        # Input order shouldn't matter — sort happens first.
        segs = [
            SimpleNamespace(start_time=3.0, speaker_label="A"),
            SimpleNamespace(start_time=1.0, speaker_label="B"),
            SimpleNamespace(start_time=2.0, speaker_label="A"),
        ]
        # Sorted by time: B, A, A → 2 turns (B→A, then A→A no change)
        assert svc._count_turns(segs) == 2


class TestRollUpFeedTextTotals:
    def test_sums_word_and_token_totals_per_feed(self):
        per_feed = [
            {"feed_id": "f1"},
            {"feed_id": "f2"},
        ]
        per_ep = [
            {"feed_id": "f1", "word_count": 100, "token_count_segments": 50, "token_count_chunks": 10},
            {"feed_id": "f1", "word_count": 200, "token_count_segments": 80, "token_count_chunks": 20},
            {"feed_id": "f2", "word_count": 50, "token_count_segments": 25, "token_count_chunks": 5},
        ]

        svc._roll_up_feed_text_totals(per_feed, per_ep)

        assert per_feed[0]["total_words"] == 300
        assert per_feed[0]["total_tokens_segments"] == 130
        assert per_feed[0]["total_tokens_chunks"] == 30
        assert per_feed[1]["total_words"] == 50

    def test_feed_with_no_episodes_gets_zeroes(self):
        per_feed = [{"feed_id": "empty"}]
        svc._roll_up_feed_text_totals(per_feed, per_ep=[])
        assert per_feed[0]["total_words"] == 0
        assert per_feed[0]["total_tokens_segments"] == 0
        assert per_feed[0]["total_tokens_chunks"] == 0


class TestTimelineMonthly:
    def test_buckets_by_month_and_sums(self):
        per_ep = [
            {"feed_id": "f1", "published_at": "2026-01-15T10:00:00Z",
             "word_count": 100, "duration_secs": 600},
            {"feed_id": "f1", "published_at": "2026-01-20T10:00:00Z",
             "word_count": 200, "duration_secs": 1200},
            {"feed_id": "f1", "published_at": "2026-02-01T10:00:00Z",
             "word_count": 50, "duration_secs": 300},
        ]
        result = svc._timeline_monthly(db=MagicMock(), per_ep=per_ep)
        assert len(result) == 2
        jan, feb = result[0], result[1]
        assert jan["month"] == "2026-01"
        assert jan["episode_count"] == 2
        assert jan["total_words"] == 300
        assert jan["total_duration_min"] == 30.0
        assert feb["month"] == "2026-02"
        assert feb["episode_count"] == 1

    def test_skips_episodes_without_published_at(self):
        per_ep = [
            {"feed_id": "f1", "published_at": None,
             "word_count": 999, "duration_secs": 9999},
        ]
        assert svc._timeline_monthly(db=MagicMock(), per_ep=per_ep) == []

    def test_sorts_by_feed_id_then_month(self):
        per_ep = [
            {"feed_id": "b", "published_at": "2026-02-01T00:00:00Z",
             "word_count": 1, "duration_secs": 60},
            {"feed_id": "a", "published_at": "2026-03-01T00:00:00Z",
             "word_count": 1, "duration_secs": 60},
            {"feed_id": "a", "published_at": "2026-01-01T00:00:00Z",
             "word_count": 1, "duration_secs": 60},
        ]
        result = svc._timeline_monthly(db=MagicMock(), per_ep=per_ep)
        assert [(r["feed_id"], r["month"]) for r in result] == [
            ("a", "2026-01"),
            ("a", "2026-03"),
            ("b", "2026-02"),
        ]


class TestIdentifyFeedHost:
    def test_prefers_feed_speaker_cache_top(self):
        feed = SimpleNamespace(
            id="f1",
            podcast_persons=[{"role": "host", "name": "Other"}],
            itunes_owner_name="Owner",
            itunes_author="Author",
        )
        top_map = {"f1": "Cached Host"}
        assert svc._identify_feed_host(feed, top_map) == "Cached Host"

    def test_falls_back_to_podcast_persons_host_role(self):
        feed = SimpleNamespace(
            id="f1",
            podcast_persons=[
                {"role": "guest", "name": "G"},
                {"role": "HOST", "name": "Real Host"},
            ],
            itunes_owner_name="Owner",
            itunes_author="Author",
        )
        assert svc._identify_feed_host(feed, feed_speaker_cache_top={}) == "Real Host"

    def test_falls_back_to_itunes_owner(self):
        feed = SimpleNamespace(
            id="f1",
            podcast_persons=[],
            itunes_owner_name="Owner",
            itunes_author="Author",
        )
        assert svc._identify_feed_host(feed, feed_speaker_cache_top={}) == "Owner"

    def test_falls_back_to_itunes_author_when_owner_missing(self):
        feed = SimpleNamespace(
            id="f1",
            podcast_persons=None,
            itunes_owner_name=None,
            itunes_author="Author",
        )
        assert svc._identify_feed_host(feed, feed_speaker_cache_top={}) == "Author"

    def test_returns_none_when_nothing_resolves(self):
        feed = SimpleNamespace(
            id="f1",
            podcast_persons=[{"role": "guest", "name": "G"}],
            itunes_owner_name=None,
            itunes_author=None,
        )
        assert svc._identify_feed_host(feed, feed_speaker_cache_top={}) is None

    def test_skips_malformed_persons_entries(self):
        feed = SimpleNamespace(
            id="f1",
            podcast_persons=[{"role": "host"}, "not-a-dict", {"role": "host", "name": "OK"}],
            itunes_owner_name=None,
            itunes_author=None,
        )
        assert svc._identify_feed_host(feed, feed_speaker_cache_top={}) == "OK"


class TestHostSpeakerLabelForEpisode:
    def _sn(self, episode_id: str, speaker_label: str, display_name: str, *,
            confirmed: bool = False, confidence: str | None = None):
        return SimpleNamespace(
            episode_id=episode_id,
            speaker_label=speaker_label,
            display_name=display_name,
            confirmed_by_user=confirmed,
            confidence=confidence,
        )

    def test_returns_label_for_confirmed_match(self):
        sn_by_ep = {
            "ep1": [self._sn("ep1", "SPEAKER_00", "Alice", confirmed=True)],
        }
        assert svc._host_speaker_label_for_episode("ep1", "Alice", sn_by_ep) == "SPEAKER_00"

    def test_returns_label_for_high_confidence_match(self):
        sn_by_ep = {
            "ep1": [self._sn("ep1", "SPEAKER_01", "Bob", confidence="HIGH")],
        }
        assert svc._host_speaker_label_for_episode("ep1", "Bob", sn_by_ep) == "SPEAKER_01"

    def test_name_normalization_collapses_case(self):
        sn_by_ep = {
            "ep1": [self._sn("ep1", "SPEAKER_00", "alice", confirmed=True)],
        }
        assert svc._host_speaker_label_for_episode("ep1", "Alice", sn_by_ep) == "SPEAKER_00"

    def test_skips_low_confidence_unconfirmed(self):
        sn_by_ep = {
            "ep1": [self._sn("ep1", "SPEAKER_00", "Alice", confidence="LOW")],
        }
        assert svc._host_speaker_label_for_episode("ep1", "Alice", sn_by_ep) is None

    def test_returns_none_when_host_name_empty(self):
        assert svc._host_speaker_label_for_episode("ep1", "", {}) is None

    def test_returns_none_when_episode_has_no_speakers(self):
        assert svc._host_speaker_label_for_episode("ep1", "Alice", {}) is None


class TestStaleFlagHelpers:
    def test_is_stale_true_when_row_has_non_false_value(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = SimpleNamespace(
            key=svc.STALE_KEY, value="token-123"
        )
        assert svc.is_stale(db) is True

    def test_is_stale_false_when_row_missing(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = None
        assert svc.is_stale(db) is False

    def test_is_stale_false_when_value_is_false_string(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = SimpleNamespace(
            key=svc.STALE_KEY, value="false"
        )
        assert svc.is_stale(db) is False

    def test_set_stale_writes_random_token_and_commits(self):
        db = MagicMock()
        svc.set_stale(db)
        db.execute.assert_called_once()
        db.commit.assert_called_once()

    def test_clear_stale_writes_false_and_commits(self):
        db = MagicMock()
        svc.clear_stale(db)
        db.execute.assert_called_once()
        db.commit.assert_called_once()

    def test_capture_stale_token_returns_value_when_set(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = SimpleNamespace(
            value="tok-xyz"
        )
        assert svc._capture_stale_token(db) == "tok-xyz"

    def test_capture_stale_token_returns_none_when_cleared(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = SimpleNamespace(
            value="false"
        )
        assert svc._capture_stale_token(db) is None

    def test_capture_stale_token_returns_none_when_missing(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = None
        assert svc._capture_stale_token(db) is None

    def test_clear_stale_if_token_noop_for_none_token(self):
        db = MagicMock()
        assert svc._clear_stale_if_token(db, None) is False
        db.commit.assert_not_called()

    def test_clear_stale_if_token_returns_true_when_row_updated(self):
        db = MagicMock()
        # The chained filter().update() returns affected-row count.
        db.query.return_value.filter.return_value.update.return_value = 1
        assert svc._clear_stale_if_token(db, "tok-1") is True
        db.commit.assert_called_once()

    def test_clear_stale_if_token_returns_false_when_rotated(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.update.return_value = 0
        assert svc._clear_stale_if_token(db, "tok-1") is False


class TestRecomputeAndStore:
    def test_orchestrates_compute_upsert_and_clear(self):
        db = MagicMock()
        fake_snap = {
            "per_episode": [{"id": "a"}, {"id": "b"}],
            "per_feed": [{"id": "f1"}],
        }

        with patch.object(svc, "_capture_stale_token", return_value="tok-A") as cap, \
             patch.object(svc, "compute_snapshot", return_value=fake_snap) as comp, \
             patch.object(svc, "upsert_snapshot", return_value="ROW") as ups, \
             patch.object(svc, "_clear_stale_if_token") as clr:
            result = svc.recompute_and_store(db)

        cap.assert_called_once_with(db)
        comp.assert_called_once_with(db)
        ups.assert_called_once_with(db, fake_snap, 2, 1)
        clr.assert_called_once_with(db, "tok-A")
        assert result == "ROW"
