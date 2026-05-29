"""
Unit tests for the ingestion orchestrator — issue #84 (selective mode, test mode ordering).
"""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

import pytest

from app.tasks.ingest import ingest_feed, TEST_MODE_MAX_EPISODES
from app.services.rss import EpisodeMeta, FeedMeta, FeedPreview


def _preview(episodes: list[EpisodeMeta]) -> FeedPreview:
    """FeedPreview wrapper matching the fetch_feed_and_episodes return shape."""
    return FeedPreview(
        feed=FeedMeta(title=None, description=None, image_url=None, website_url=None),
        episodes=episodes,
    )


def _make_episode_meta(guid: str, title: str = "") -> EpisodeMeta:
    return EpisodeMeta(
        guid=guid,
        title=title or guid,
        description=None,
        audio_url=f"https://example.com/{guid}.mp3",
        episode_url=None,
        published_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
        duration_secs=3600,
    )


def _make_db(
    feed_mode: str = "full",
    existing_guids: list[str] | None = None,
    paused: bool = False,
):
    """Return a mock SQLAlchemy session pre-configured with a feed and optional existing GUIDs."""
    db = MagicMock()
    feed = MagicMock()
    feed.id = "feed-1"
    feed.url = "https://example.com/feed.xml"
    feed.mode = feed_mode
    # Issue #743: MagicMock defaults are truthy; pin paused explicitly so existing
    # tests don't accidentally hit the paused-feed early-return.
    feed.paused = paused

    db.query.return_value.filter.return_value.first.return_value = feed

    # Simulate existing GUIDs query
    existing = [(g,) for g in (existing_guids or [])]
    db.query.return_value.filter.return_value.all.return_value = existing

    # Simulate episode count for test mode
    db.query.return_value.filter.return_value.count.return_value = len(existing_guids or [])

    return db, feed


class TestSelectiveMode:
    def test_only_selected_guids_are_ingested(self):
        episodes = [_make_episode_meta(f"ep-{i:03d}") for i in range(5)]
        db, feed = _make_db(feed_mode="selective")
        feed.mode = "selective"

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.rss_service.fetch_feed_and_episodes", return_value=_preview(episodes)),
            patch("app.tasks.ingest.job_queue.enqueue") as mock_enqueue,
        ):
            result = ingest_feed("feed-1", selected_guids=["ep-001", "ep-003"])

        assert result["new_episodes"] == 2
        assert mock_enqueue.call_count == 2

    def test_invalid_guid_returns_error(self):
        episodes = [_make_episode_meta("ep-001"), _make_episode_meta("ep-002")]
        db, feed = _make_db(feed_mode="selective")
        feed.mode = "selective"

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.rss_service.fetch_feed_and_episodes", return_value=_preview(episodes)),
            patch("app.tasks.ingest.job_queue.enqueue"),
        ):
            result = ingest_feed("feed-1", selected_guids=["ep-001", "ep-BOGUS"])

        assert "error" in result
        assert "GUIDs not present in feed" in result["error"]

    def test_selective_feed_skipped_on_periodic_poll(self):
        """When selected_guids is None (periodic poll), selective feeds are skipped."""
        db, feed = _make_db(feed_mode="selective")
        feed.mode = "selective"

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.rss_service.fetch_feed_and_episodes") as mock_fetch,
        ):
            result = ingest_feed("feed-1", selected_guids=None)

        mock_fetch.assert_not_called()
        assert result["reason"] == "selective_mode_no_new_episodes"

    def test_already_existing_guid_not_re_enqueued(self):
        """GUIDs already in the DB are skipped even in selective mode."""
        episodes = [_make_episode_meta("ep-001"), _make_episode_meta("ep-002")]
        db, feed = _make_db(feed_mode="selective", existing_guids=["ep-001"])
        feed.mode = "selective"

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.rss_service.fetch_feed_and_episodes", return_value=_preview(episodes)),
            patch("app.tasks.ingest.job_queue.enqueue") as mock_enqueue,
        ):
            result = ingest_feed("feed-1", selected_guids=["ep-001", "ep-002"])

        # ep-001 already exists — only ep-002 should be enqueued
        assert result["new_episodes"] == 1
        assert mock_enqueue.call_count == 1


class TestTestModeOrdering:
    def test_default_max_episodes_is_1(self):
        assert TEST_MODE_MAX_EPISODES == 1

    def test_takes_first_n_not_random(self):
        """Test mode should take the first N episodes (most recent), not a random sample."""
        episodes = [_make_episode_meta(f"ep-{i:03d}") for i in range(10)]
        db, feed = _make_db(feed_mode="test")

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.rss_service.fetch_feed_and_episodes", return_value=_preview(episodes)),
            patch("app.tasks.ingest.job_queue.enqueue") as mock_enqueue,
        ):
            result = ingest_feed("feed-1")

        assert result["new_episodes"] == TEST_MODE_MAX_EPISODES
        assert mock_enqueue.call_count == TEST_MODE_MAX_EPISODES
        # Verify the first episode (index 0, most recent) was selected
        created_episode = db.add.call_args[0][0]
        assert created_episode.guid == "ep-000"

    def test_test_mode_limit_reached_skips_ingestion(self):
        episodes = [_make_episode_meta("ep-001")]
        # Simulate existing_count == TEST_MODE_MAX_EPISODES
        db, feed = _make_db(feed_mode="test", existing_guids=["ep-000"])
        feed.mode = "test"
        db.query.return_value.filter.return_value.count.return_value = TEST_MODE_MAX_EPISODES

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.rss_service.fetch_feed_and_episodes", return_value=_preview(episodes)),
            patch("app.tasks.ingest.job_queue.enqueue") as mock_enqueue,
        ):
            result = ingest_feed("feed-1")

        assert result["reason"] == "test_mode_limit_reached"
        mock_enqueue.assert_not_called()


class TestPodcastPersonsRefresh:
    """PRD-04 B2: channel-level <podcast:person> must be refreshed on poll
    with keep-on-removal semantics (matches itunes_author/owner behavior).
    """

    def _preview_with_persons(self, persons: list[dict]) -> FeedPreview:
        return FeedPreview(
            feed=FeedMeta(
                title=None,
                description=None,
                image_url=None,
                website_url=None,
                podcast_persons=persons,
            ),
            episodes=[],
        )

    def test_non_empty_persons_overwrites_stored_list(self):
        """A poll returning new persons replaces the stored list."""
        db, feed = _make_db(feed_mode="full")
        feed.podcast_persons = [{"name": "Old Host", "role": "host"}]
        new_persons = [
            {"name": "New Host", "role": "host", "group": "cast"},
            {"name": "Co Person", "role": "cohost", "group": "cast"},
        ]
        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch(
                "app.tasks.ingest.rss_service.fetch_feed_and_episodes",
                return_value=self._preview_with_persons(new_persons),
            ),
            patch("app.tasks.ingest.job_queue.enqueue"),
        ):
            ingest_feed("feed-1")

        assert feed.podcast_persons == new_persons

    def test_empty_persons_preserves_stored_list(self):
        """Publisher dropped all <podcast:person> tags — keep last-known value."""
        db, feed = _make_db(feed_mode="full")
        stored = [{"name": "Tim Ferriss", "role": "host"}]
        feed.podcast_persons = stored
        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch(
                "app.tasks.ingest.rss_service.fetch_feed_and_episodes",
                return_value=self._preview_with_persons([]),
            ),
            patch("app.tasks.ingest.job_queue.enqueue"),
        ):
            ingest_feed("feed-1")

        # The stored list must still be present (keep-on-removal).
        assert feed.podcast_persons == stored


class TestPreviewEndpoint:
    def test_preview_returns_feed_and_episodes(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.rss import FeedMeta, FeedPreview, EpisodeMeta as EM

        client = TestClient(app)

        fake_preview = FeedPreview(
            feed=FeedMeta(
                title="My Podcast",
                description="A show",
                image_url=None,
                website_url="https://example.com",
            ),
            episodes=[
                EM(
                    guid="ep-001",
                    title="Episode 1",
                    description=None,
                    audio_url="https://example.com/ep1.mp3",
                    episode_url=None,
                    published_at=datetime(2024, 1, 1, tzinfo=timezone.utc),
                    duration_secs=3600,
                )
            ],
        )

        with patch("app.api.feeds.rss_service.preview_feed", return_value=fake_preview):
            resp = client.get("/api/feeds/preview?url=https://example.com/feed.xml")

        assert resp.status_code == 200
        data = resp.json()
        assert data["title"] == "My Podcast"
        assert len(data["episodes"]) == 1
        assert data["episodes"][0]["guid"] == "ep-001"
        assert data["episodes"][0]["duration_secs"] == 3600

    def test_preview_missing_url_returns_422(self):
        from fastapi.testclient import TestClient
        from app.main import app

        client = TestClient(app)
        resp = client.get("/api/feeds/preview")
        assert resp.status_code == 422

    def test_preview_invalid_feed_returns_422(self):
        from fastapi.testclient import TestClient
        from app.main import app
        from app.services.rss import InvalidFeedError

        client = TestClient(app)
        with patch(
            "app.api.feeds.rss_service.preview_feed",
            side_effect=InvalidFeedError("Not a feed"),
        ):
            resp = client.get("/api/feeds/preview?url=https://example.com/not-a-feed")

        assert resp.status_code == 422
        assert "Not a feed" in resp.json()["detail"]


class TestPausedFeed:
    """Issue #743: paused feeds skip ingestion without touching processed episodes."""

    def test_paused_feed_skips_ingest_without_fetching_rss(self):
        db, feed = _make_db(feed_mode="full", paused=True)

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.rss_service.fetch_feed_and_episodes") as mock_fetch,
            patch("app.tasks.ingest.job_queue.enqueue") as mock_enqueue,
        ):
            result = ingest_feed("feed-1")

        assert result == {"new_episodes": 0, "reason": "feed_paused"}
        # No network and no job enqueue when the feed is paused
        mock_fetch.assert_not_called()
        mock_enqueue.assert_not_called()

    def test_poll_all_feeds_excludes_paused(self):
        """poll_all_feeds filters out paused feeds via the SQL query."""
        from app.tasks.ingest import poll_all_feeds

        db = MagicMock()
        active = MagicMock(id="feed-active", paused=False, mode="full")
        # Simulate what the filter returns — only active feeds.
        db.query.return_value.filter.return_value.all.return_value = [active]

        with (
            patch("app.tasks.ingest.SessionLocal", return_value=db),
            patch("app.tasks.ingest.ingest_feed") as mock_ingest,
        ):
            result = poll_all_feeds()

        assert result == {"polled": 1}
        mock_ingest.assert_called_once_with("feed-active")
