"""
Unit tests for FastAPI endpoints — PRD-01 §12

Uses FastAPI TestClient with a mocked database.
"""
import pytest
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestHealthEndpoint:
    def test_ok_when_prewarm_done(self):
        with patch("app.api.health.redis") as mock_redis_mod, \
             patch("app.api.health.SessionLocal") as mock_session_cls:
            mock_r = MagicMock()
            mock_r.ping.return_value = True
            mock_r.get.return_value = b"1"  # prewarm done
            mock_redis_mod.from_url.return_value = mock_r
            mock_session_cls.return_value = MagicMock()

            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "OK"
            assert isinstance(data["services"], list)
            assert any(s["name"] == "Worker" and s["status"] == "OK" for s in data["services"])

    def test_warming_up_when_prewarm_not_done(self):
        with patch("app.api.health.redis") as mock_redis_mod, \
             patch("app.api.health.SessionLocal") as mock_session_cls:
            mock_r = MagicMock()
            mock_r.ping.return_value = True
            mock_r.get.return_value = None  # prewarm not done
            mock_redis_mod.from_url.return_value = mock_r
            mock_session_cls.return_value = MagicMock()

            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "WARMING_UP"
            assert any(s["name"] == "Worker" and s["status"] == "WARMING_UP" for s in data["services"])

    def test_degraded_when_redis_unreachable(self):
        with patch("app.api.health.redis") as mock_redis_mod, \
             patch("app.api.health.SessionLocal") as mock_session_cls:
            mock_r = MagicMock()
            mock_r.ping.side_effect = Exception("Connection refused")
            mock_redis_mod.from_url.return_value = mock_r
            mock_session_cls.return_value = MagicMock()

            resp = client.get("/api/health")
            assert resp.status_code == 200
            assert resp.json()["status"] == "DEGRADED"


class TestFeedsEndpoint:
    def test_add_feed_invalid_rss_returns_422(self):
        with patch("app.api.feeds.rss_service.validate_and_parse_feed") as mock_validate:
            from app.services.rss import InvalidFeedError
            mock_validate.side_effect = InvalidFeedError("Not an RSS feed")

            resp = client.post("/api/feeds", json={"url": "https://example.com/not-a-feed"})
            assert resp.status_code == 422
            assert "Not an RSS feed" in resp.json()["detail"]

    def test_list_feeds_returns_empty(self):
        mock_db = MagicMock()
        mock_db.query.return_value.order_by.return_value.all.return_value = []

        from app.database import get_db
        app.dependency_overrides[get_db] = lambda: mock_db
        try:
            resp = client.get("/api/feeds")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            app.dependency_overrides.clear()
