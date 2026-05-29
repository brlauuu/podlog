"""Unit tests for the inferred-speaker noise filters (#749).

Covers ``_is_denylisted_inferred_name`` and ``_merge_inferred_fragments``
in ``app.services.meta_analysis_aggregations``.
"""
import pytest

from app.services.meta_analysis_aggregations import (
    _is_denylisted_inferred_name,
    _merge_inferred_fragments,
)


def _row(
    *,
    feed_id: str = "f1",
    episode_id: str = "ep1",
    display_name: str,
    source: str = "inferred_high",
    minutes: float = 1.0,
    words: int = 100,
    role: str | None = None,
):
    return {
        "feed_id": feed_id,
        "feed_title": "F",
        "episode_id": episode_id,
        "episode_title": "E",
        "published_at": "2026-01-01T00:00:00+00:00",
        "display_name": display_name,
        "role": role,
        "source": source,
        "minutes": minutes,
        "words": words,
    }


class TestDenylist:
    @pytest.mark.parametrize(
        "name", ["Twitter", "twitter", "LinkedIn", "linkedin", "Apple", "Spotify", "X"]
    )
    def test_platform_names_are_denylisted(self, name: str):
        assert _is_denylisted_inferred_name(name) is True

    @pytest.mark.parametrize("name", ["Marko Papic", "Jane Doe", "Sam"])
    def test_real_names_pass(self, name: str):
        assert _is_denylisted_inferred_name(name) is False

    def test_empty_name_treated_as_junk(self):
        assert _is_denylisted_inferred_name("") is True


class TestFragmentMerge:
    def test_fragment_folds_into_longest_sibling_same_episode(self):
        rows = [
            _row(display_name="Marko", minutes=2.0, words=200),
            _row(display_name="Marko Papic", minutes=3.0, words=300),
        ]
        out = _merge_inferred_fragments(rows)
        # One row remains; minutes + words summed under the longer name.
        assert len(out) == 1
        assert out[0]["display_name"] == "Marko Papic"
        assert out[0]["minutes"] == pytest.approx(5.0)
        assert out[0]["words"] == 500

    def test_fragment_only_merges_within_same_feed(self):
        rows = [
            _row(feed_id="f1", display_name="Marko", minutes=2.0),
            _row(feed_id="f2", display_name="Marko Papic", minutes=3.0),
        ]
        out = _merge_inferred_fragments(rows)
        # Cross-feed pairs do NOT merge — each feed's inferred space stands alone.
        assert {(r["feed_id"], r["display_name"]) for r in out} == {
            ("f1", "Marko"),
            ("f2", "Marko Papic"),
        }

    def test_confirmed_rows_are_not_touched(self):
        rows = [
            _row(display_name="Marko", source="confirmed", role="host"),
            _row(display_name="Marko Papic", source="inferred_high"),
        ]
        out = _merge_inferred_fragments(rows)
        # Confirmed "Marko" survives; inferred row stays as itself (no fragment
        # sibling within inferred_high).
        names = sorted((r["display_name"], r["source"]) for r in out)
        assert names == [("Marko", "confirmed"), ("Marko Papic", "inferred_high")]

    def test_no_change_when_no_prefix_overlap(self):
        rows = [
            _row(display_name="Alice", episode_id="ep1"),
            _row(display_name="Bob", episode_id="ep1"),
        ]
        out = _merge_inferred_fragments(rows)
        assert {r["display_name"] for r in out} == {"Alice", "Bob"}

    def test_fragment_in_different_episode_still_merges(self):
        # Per-episode rollups still need rewriting so the chart legend
        # collapses to one trace per canonical name.
        rows = [
            _row(episode_id="ep1", display_name="Marko"),
            _row(episode_id="ep2", display_name="Marko Papic"),
        ]
        out = _merge_inferred_fragments(rows)
        assert {(r["episode_id"], r["display_name"]) for r in out} == {
            ("ep1", "Marko Papic"),
            ("ep2", "Marko Papic"),
        }
