"""
End-to-end tests — PRD-01 §12

Spins up the full Docker stack and exercises the complete ingestion flow
using a mock RSS feed served by nginx (see docker-compose.test.yml).
"""
import os
import time

import httpx
import pytest

PIPELINE_URL = os.environ.get("PIPELINE_API_URL", "http://localhost:8000")
MOCK_RSS_URL = os.environ.get("MOCK_RSS_URL", "http://mock_rss/feed.xml")


@pytest.mark.e2e
class TestFullIngestionFlow:
    def test_add_feed_and_wait_for_completion(self):
        """
        POST a mock RSS feed → poll /api/queue until episode is done
        → assert segments exist in database.
        """
        pytest.skip("E2E test stub — implement with running Docker stack")

    def test_transcript_file_written(self):
        """After ingestion, assert .txt file exists in /data/transcripts/."""
        pytest.skip("E2E test stub")
