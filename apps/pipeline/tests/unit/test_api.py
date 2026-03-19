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
    def test_ok_when_prewarm_done(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = _mock_prewarm_row(True)
        with patch("app.api.health.SessionLocal", return_value=mock_db):
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "OK"
            assert isinstance(data["services"], list)
            assert any(s["name"] == "Worker" and s["status"] == "OK" for s in data["services"])

    def test_warming_up_when_prewarm_not_done(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = _mock_prewarm_row(False)
        with patch("app.api.health.SessionLocal", return_value=mock_db):
            resp = client.get("/api/health")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "WARMING_UP"
            assert any(s["name"] == "Worker" and s["status"] == "WARMING_UP" for s in data["services"])

    def test_degraded_when_db_unreachable(self):
        mock_db = MagicMock()
        mock_db.execute.side_effect = Exception("Connection refused")
        with patch("app.api.health.SessionLocal", return_value=mock_db):
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

    def test_list_feeds_removed(self):
        """GET /api/feeds was moved to Next.js direct DB — should return 405."""
        resp = client.get("/api/feeds")
        assert resp.status_code == 405
