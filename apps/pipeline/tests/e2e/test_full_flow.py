"""
Liveness check against a running stack — PRD-01 §12.

NOT a full-flow test, despite the filename. It asserts one thing: that
/api/health answers on a stack that is already up. The complete
ingest -> archive chain is exercised by
tests/integration/test_pipeline_flow.py (#1015), which runs in CI.

This file's docstring claimed to exercise "the complete ingestion flow"
for months, and CLAUDE.md repeated the claim, which made the gap look
like a wiring job rather than a missing test.

Run with: make test-e2e
"""
import os
import time

import httpx
import pytest

PIPELINE_URL = os.environ.get("PIPELINE_API_URL", "http://pipeline_test:8000")


@pytest.mark.e2e
class TestFullIngestionFlow:
    """Requires a running Docker stack (docker compose -f docker-compose.test.yml up)."""

    def test_health_endpoint(self):
        """Pipeline /api/health returns 200."""
        resp = httpx.get(f"{PIPELINE_URL}/api/health", timeout=10)
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] in ("OK", "WARMING_UP")
