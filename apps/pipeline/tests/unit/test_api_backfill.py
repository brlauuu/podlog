"""Unit tests for app.api.backfill — backfill API endpoint."""
from unittest.mock import MagicMock, patch

import pytest
from fastapi.testclient import TestClient


class TestBackfillChunksEndpoint:
    def _get_client(self):
        from app.main import app

        return TestClient(app)

    def test_starts_backfill(self):
        import app.api.backfill as backfill_mod

        backfill_mod._running = False
        client = self._get_client()

        with patch("app.api.backfill.Thread") as mock_thread:
            mock_thread.return_value.start = MagicMock()
            resp = client.post("/api/backfill/chunks?embed=true")

        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "started"
        assert data["embed"] is True
        backfill_mod._running = False  # reset

    def test_already_running(self):
        import app.api.backfill as backfill_mod

        backfill_mod._running = True
        try:
            client = self._get_client()
            resp = client.post("/api/backfill/chunks")

            assert resp.status_code == 200
            assert resp.json()["status"] == "already_running"
        finally:
            backfill_mod._running = False


class TestBackfillStatusEndpoint:
    def _get_client(self):
        from app.main import app

        return TestClient(app)

    def test_status_idle(self):
        import app.api.backfill as backfill_mod

        backfill_mod._running = False
        client = self._get_client()
        resp = client.get("/api/backfill/status")

        assert resp.status_code == 200
        assert resp.json()["status"] == "idle"

    def test_status_running(self):
        import app.api.backfill as backfill_mod
        import app.tasks.backfill_chunks as backfill_task

        backfill_mod._running = True
        backfill_task.progress = {
            "episodes_total": 15,
            "episodes_done": 5,
            "chunks_created": 200,
            "segments_embedded": 1000,
        }
        try:
            client = self._get_client()
            resp = client.get("/api/backfill/status")

            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "running"
            assert data["episodes_total"] == 15
            assert data["episodes_done"] == 5
        finally:
            backfill_mod._running = False
            backfill_task.progress = {}
