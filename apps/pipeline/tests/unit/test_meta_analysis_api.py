"""Unit tests for app.api.meta_analysis (#556)."""
from __future__ import annotations

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest
from fastapi import HTTPException

from app.api.meta_analysis import (
    _serialize,
    get_snapshot,
    missing_speakers,
    post_refresh,
)


def _fake_row(snapshot: dict | None = None):
    return SimpleNamespace(
        snapshot=snapshot if snapshot is not None else {"per_feed": []},
        computed_at=datetime(2026, 4, 24, 12, 0, tzinfo=timezone.utc),
        episode_count=3,
        feed_count=2,
    )


class TestSerialize:
    def test_none_row_returns_empty_shape_with_stale_flag(self):
        result = _serialize(None, stale=True)
        assert result == {
            "snapshot": None,
            "computed_at": None,
            "episode_count": 0,
            "feed_count": 0,
            "is_stale": True,
            "last_error": None,
        }

    def test_serializes_row_fields(self):
        row = _fake_row({"per_feed": [{"feed_id": "f1"}]})
        result = _serialize(row, stale=False)
        assert result["snapshot"] == {"per_feed": [{"feed_id": "f1"}]}
        assert result["computed_at"] == "2026-04-24T12:00:00+00:00"
        assert result["episode_count"] == 3
        assert result["feed_count"] == 2
        assert result["is_stale"] is False
        assert result["last_error"] is None

    def test_handles_missing_computed_at(self):
        row = SimpleNamespace(
            snapshot={}, computed_at=None, episode_count=0, feed_count=0
        )
        assert _serialize(row, stale=True)["computed_at"] is None


class TestGetSnapshot:
    def test_returns_empty_stale_when_no_row(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = None
        result = get_snapshot(db)
        assert result["snapshot"] is None
        assert result["is_stale"] is True
        assert result["episode_count"] == 0

    def test_returns_serialized_row_with_stale_flag_from_service(self):
        db = MagicMock()
        row = _fake_row({"per_feed": []})
        db.query.return_value.filter.return_value.one_or_none.return_value = row

        with patch("app.api.meta_analysis.is_stale", return_value=False):
            result = get_snapshot(db)

        assert result["snapshot"] == {"per_feed": []}
        assert result["is_stale"] is False
        assert result["episode_count"] == 3


class TestPostRefresh:
    def test_acquires_advisory_lock_and_returns_serialized_row(self):
        db = MagicMock()
        row = _fake_row({"per_episode": []})

        with patch("app.api.meta_analysis.recompute_and_store", return_value=row) as mock_recompute:
            result = post_refresh(db)

        # Advisory lock acquired via db.execute(...)
        db.execute.assert_called_once()
        mock_recompute.assert_called_once_with(db)
        assert result["is_stale"] is False
        assert result["episode_count"] == 3

    def test_wraps_recompute_exceptions_in_http_500(self):
        db = MagicMock()

        with patch(
            "app.api.meta_analysis.recompute_and_store",
            side_effect=RuntimeError("boom"),
        ):
            with pytest.raises(HTTPException) as exc_info:
                post_refresh(db)

        assert exc_info.value.status_code == 500
        assert "Recompute failed" in exc_info.value.detail


class TestMissingSpeakers:
    def test_returns_empty_podcasts_when_snapshot_row_missing(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.one_or_none.return_value = None
        assert missing_speakers(db) == {"podcasts": []}

    def test_returns_empty_podcasts_when_no_excluded_entries(self):
        db = MagicMock()
        row = SimpleNamespace(
            snapshot={"coverage": {"host_share": {"excluded": []}}}
        )
        db.query.return_value.filter.return_value.one_or_none.return_value = row
        assert missing_speakers(db) == {"podcasts": []}

    def test_groups_excluded_episodes_by_feed(self):
        db = MagicMock()
        snapshot = {
            "coverage": {
                "host_share": {
                    "excluded": [
                        {
                            "episode_id": "ep-1",
                            "feed_id": "feed-A",
                            "feed_title": "Feed A",
                            "title": "Ep One",
                            "reason": "no confirmed host",
                        },
                        {
                            "episode_id": "ep-2",
                            "feed_id": "feed-A",
                            "feed_title": "Feed A",
                            "title": "Ep Two",
                            "reason": "no chunks yet",
                        },
                        {
                            "episode_id": "ep-3",
                            "feed_id": "feed-B",
                            "feed_title": "Feed B",
                            "title": "Ep Three",
                            "reason": "no confirmed host",
                        },
                    ]
                }
            }
        }
        row = SimpleNamespace(snapshot=snapshot)
        db.query.return_value.filter.return_value.one_or_none.return_value = row

        result = missing_speakers(db)
        podcasts = {p["feed_id"]: p for p in result["podcasts"]}
        assert set(podcasts) == {"feed-A", "feed-B"}
        assert podcasts["feed-A"]["title"] == "Feed A"
        assert len(podcasts["feed-A"]["episodes"]) == 2
        assert podcasts["feed-A"]["episodes"][0] == {
            "id": "ep-1", "title": "Ep One", "reason": "no confirmed host"
        }
        assert podcasts["feed-B"]["episodes"][0]["id"] == "ep-3"

    def test_handles_missing_coverage_path_gracefully(self):
        db = MagicMock()
        row = SimpleNamespace(snapshot={})  # no "coverage" key
        db.query.return_value.filter.return_value.one_or_none.return_value = row
        assert missing_speakers(db) == {"podcasts": []}
