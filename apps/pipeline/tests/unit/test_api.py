"""
Unit tests for FastAPI endpoints -- PRD-01 S12

Uses FastAPI TestClient with a mocked database.
"""
from unittest.mock import patch, MagicMock
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


class TestHealthEndpoint:
    def test_ok_when_prewarm_done(self):
        with patch("app.api.health.SessionLocal") as mock_session_cls, \
             patch("app.api.health.Path") as mock_path_cls:
            mock_session_cls.return_value = MagicMock()
            mock_path_cls.return_value.exists.return_value = True

            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "OK"
            assert isinstance(data["services"], list)
            assert any(s["name"] == "Worker" and s["status"] == "OK" for s in data["services"])

    def test_warming_up_when_prewarm_not_done(self):
        with patch("app.api.health.SessionLocal") as mock_session_cls, \
             patch("app.api.health.Path") as mock_path_cls:
            mock_session_cls.return_value = MagicMock()
            mock_path_cls.return_value.exists.return_value = False

            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "WARMING_UP"
            assert any(s["name"] == "Worker" and s["status"] == "WARMING_UP" for s in data["services"])

    def test_degraded_when_db_unreachable(self):
        with patch("app.api.health.SessionLocal") as mock_session_cls, \
             patch("app.api.health.Path") as mock_path_cls:
            mock_db = MagicMock()
            mock_db.execute.side_effect = Exception("Connection refused")
            mock_session_cls.return_value = mock_db
            mock_path_cls.return_value.exists.return_value = True

            resp = client.get("/api/health")
            assert resp.status_code == 200
            assert resp.json()["status"] == "DEGRADED"


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
