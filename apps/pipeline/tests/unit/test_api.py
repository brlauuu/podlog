"""
Unit tests for FastAPI endpoints -- PRD-01 S12

Uses FastAPI TestClient with a mocked database.
"""
from unittest.mock import patch, MagicMock

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def _mock_prewarm_row(done: bool):
    """Create a mock SystemState row for prewarm_done."""
    if done:
        row = MagicMock()
        row.value = "1"
        return row
    return None


class TestHealthEndpoint:
    def _mock_ollama_ok(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        return patch("app.api.health.httpx.get", return_value=mock_resp)

    def test_ok_when_prewarm_done(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = _mock_prewarm_row(True)
        with patch("app.api.health.SessionLocal", return_value=mock_db), self._mock_ollama_ok():
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "OK"
            assert isinstance(data["services"], list)
            assert any(s["name"] == "Worker" and s["status"] == "OK" for s in data["services"])
            assert any(s["name"] == "Ollama" and s["status"] == "OK" for s in data["services"])

    def test_warming_up_when_prewarm_not_done(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = _mock_prewarm_row(False)
        with patch("app.api.health.SessionLocal", return_value=mock_db), self._mock_ollama_ok():
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "WARMING_UP"
            assert any(s["name"] == "Worker" and s["status"] == "WARMING_UP" for s in data["services"])

    def test_degraded_when_db_unreachable(self):
        mock_db = MagicMock()
        mock_db.execute.side_effect = Exception("Connection refused")
        with patch("app.api.health.SessionLocal", return_value=mock_db), self._mock_ollama_ok():
            resp = client.get("/api/health")
            assert resp.status_code == 200
            assert resp.json()["status"] == "DEGRADED"

    def test_ollama_degraded_when_unreachable(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = _mock_prewarm_row(True)
        with patch("app.api.health.SessionLocal", return_value=mock_db), \
             patch("app.api.health.httpx.get", side_effect=Exception("Connection refused")):
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "DEGRADED"
            assert any(s["name"] == "Ollama" and s["status"] == "DEGRADED" for s in data["services"])

    def test_ollama_marked_ok_when_runtime_provider_fireworks_overrides_env_local(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = _mock_prewarm_row(True)
        with (
            patch("app.api.health.SessionLocal", return_value=mock_db),
            patch("app.api.health.settings.inference_provider", "local"),
            patch("app.api.health.get_runtime_inference_settings", return_value={"inference_provider": "fireworks"}),
            patch("app.api.health.httpx.get", side_effect=Exception("should not be called")) as mock_http,
        ):
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert any(s["name"] == "Ollama" and s["status"] == "OK" for s in data["services"])
            mock_http.assert_not_called()

    def test_ollama_checked_when_runtime_provider_local_overrides_env_fireworks(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = _mock_prewarm_row(True)
        with (
            patch("app.api.health.SessionLocal", return_value=mock_db),
            patch("app.api.health.settings.inference_provider", "fireworks"),
            patch("app.api.health.get_runtime_inference_settings", return_value={"inference_provider": "local"}),
            patch("app.api.health.httpx.get", side_effect=Exception("Connection refused")),
        ):
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "DEGRADED"
            assert any(s["name"] == "Ollama" and s["status"] == "DEGRADED" for s in data["services"])


class TestFeedsEndpoint:
    def test_add_feed_invalid_rss_returns_422(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None

        from app.database import get_db
        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            with patch("app.api.feeds.rss_service.validate_and_parse_feed") as mock_validate:
                from app.services.rss import InvalidFeedError
                mock_validate.side_effect = InvalidFeedError("Not an RSS feed")

                resp = client.post("/api/feeds", json={"url": "https://example.com/not-a-feed"})
                assert resp.status_code == 422
                assert "Not an RSS feed" in resp.json()["detail"]
        finally:
            app.dependency_overrides.clear()

    def test_add_feed_selective_without_guids_returns_422(self):
        """Selective mode requires selected_guids."""
        resp = client.post(
            "/api/feeds",
            json={"url": "https://example.com/feed.xml", "mode": "selective"},
        )
        assert resp.status_code == 422
        assert "selected_guids" in resp.json()["detail"]

    def test_add_feed_selective_with_guids_accepted(self):
        """Selective mode with valid GUIDs proceeds past validation."""
        from datetime import datetime, timezone

        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None

        # SQLAlchemy column defaults only run during INSERT; simulate db.refresh populating them
        def _mock_refresh(obj):
            obj.id = "test-feed-uuid"
            obj.created_at = datetime(2024, 1, 1, tzinfo=timezone.utc)
            obj.last_polled_at = None

        mock_db.refresh.side_effect = _mock_refresh

        from app.database import get_db
        from app.services.rss import FeedMeta

        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            with (
                patch(
                    "app.api.feeds.rss_service.validate_and_parse_feed",
                    return_value=FeedMeta(title="T", description=None, image_url=None, website_url=None),
                ),
                patch("app.api.feeds._ingest_feed"),
            ):
                resp = client.post(
                    "/api/feeds",
                    json={
                        "url": "https://example.com/feed.xml",
                        "mode": "selective",
                        "selected_guids": ["ep-001"],
                    },
                )
            assert resp.status_code == 201
            assert resp.json()["mode"] == "selective"
        finally:
            app.dependency_overrides.clear()

    def test_list_feeds_returns_rows(self):
        mock_db = MagicMock()
        mock_rows = [
            {
                "id": "feed-1",
                "url": "https://example.com/rss.xml",
                "title": "Example Feed",
                "mode": "full",
                "last_polled_at": None,
                "episode_count": 12,
            }
        ]
        mock_db.execute.return_value.mappings.return_value.all.return_value = mock_rows

        from app.database import get_db

        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            resp = client.get("/api/feeds")
            assert resp.status_code == 200
            assert resp.json() == mock_rows
        finally:
            app.dependency_overrides.clear()


class TestDeleteEpisodeEndpoint:
    """Issue #454: manually uploaded episodes need a delete endpoint."""

    def test_delete_unknown_episode_returns_404(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None

        from app.database import get_db

        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            resp = client.delete("/api/episodes/does-not-exist")
            assert resp.status_code == 404
            assert resp.json()["detail"] == "Episode not found"
        finally:
            app.dependency_overrides.clear()

    def test_delete_feed_linked_episode_returns_403(self):
        mock_db = MagicMock()
        mock_episode = MagicMock()
        mock_episode.feed_id = "feed-uuid"
        mock_db.query.return_value.filter.return_value.first.return_value = mock_episode

        from app.database import get_db

        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            resp = client.delete("/api/episodes/some-episode-id")
            assert resp.status_code == 403
            assert "Feed-linked" in resp.json()["detail"]
            mock_db.delete.assert_not_called()
        finally:
            app.dependency_overrides.clear()

    def test_delete_manual_upload_returns_204(self):
        mock_db = MagicMock()
        mock_episode = MagicMock()
        mock_episode.feed_id = None
        mock_episode.audio_local_path = None
        mock_episode.transcript_path = None
        mock_db.query.return_value.filter.return_value.first.return_value = mock_episode

        from app.database import get_db

        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            with patch("app.api.episodes._remove_episode_files"):
                resp = client.delete("/api/episodes/some-episode-id")
            assert resp.status_code == 204
            mock_db.delete.assert_called_once_with(mock_episode)
            mock_db.commit.assert_called_once()
        finally:
            app.dependency_overrides.clear()
