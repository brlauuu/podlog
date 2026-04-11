"""
End-to-end tests — PRD-01 §12

Spins up the full Docker stack and exercises the complete ingestion flow
using a mock RSS feed served by nginx (see docker-compose.test.yml).

Run with: make test-e2e
"""
import os
import time

import httpx

PIPELINE_URL = os.environ.get("PIPELINE_API_URL", "http://pipeline_test:8000")


class TestFullIngestionFlow:
    """Requires a running Docker stack (docker compose -f docker-compose.test.yml up)."""

    def test_health_endpoint(self):
        """Pipeline /api/health returns 200."""
        resp = httpx.get(f"{PIPELINE_URL}/api/health", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] in ("OK", "WARMING_UP")
