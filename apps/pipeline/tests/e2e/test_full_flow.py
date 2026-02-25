"""
End-to-end tests — PRD-01 §12

Spins up the full Docker stack and exercises the complete ingestion flow
using a mock RSS feed served by nginx (see docker-compose.test.yml).

Run with: make test-e2e
"""
import os
import time

import httpx
import pytest

PIPELINE_URL = os.environ.get("PIPELINE_API_URL", "http://localhost:8000")


@pytest.mark.e2e
class TestFullIngestionFlow:
    """Requires a running Docker stack (docker compose -f docker-compose.test.yml up)."""

    def test_health_endpoint(self):
        """Pipeline /api/health returns 200."""
        resp = httpx.get(f"{PIPELINE_URL}/api/health", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] in ("OK", "WARMING_UP")

    def test_add_feed_and_poll(self):
        """
        POST a feed → trigger poll → verify episode(s) enqueued.
        """
        pytest.skip("E2E stub — requires mock RSS server in test stack")

    def test_full_ingestion_produces_transcript(self):
        """
        POST a feed with a 10-second audio file → wait for completion
        → assert segments exist and transcript file written.
        """
        pytest.skip("E2E stub — requires mock RSS server + audio fixture in test stack")
