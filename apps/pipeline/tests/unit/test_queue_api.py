"""Tests for the queue API response structure."""
from datetime import datetime
from unittest.mock import MagicMock, patch

from app.api.queue import ACTIVE_STATUSES, NON_RETRYABLE, QueueStateResponse, _job_dict, retry_job


def _make_episode(status, **kwargs):
    """Create a mock Episode with required fields."""
    ep = MagicMock()
    ep.id = kwargs.get("id", "ep-1")
    ep.title = kwargs.get("title", "Test Episode")
    ep.status = status
    ep.error_message = kwargs.get("error_message", None)
    ep.error_class = kwargs.get("error_class", None)
    ep.retry_count = kwargs.get("retry_count", 0)
    ep.retry_max = kwargs.get("retry_max", 3)
    ep.updated_at = kwargs.get("updated_at", None)
    ep.feed = MagicMock()
    ep.feed.mode = kwargs.get("feed_mode", "live")
    ep.feed.title = kwargs.get("feed_title", "Test Feed")
    return ep


class TestGetQueue:
    def test_inferring_episodes_are_active(self):
        """Inferring episodes should appear in active_jobs, not be omitted."""
        assert "inferring" in ACTIVE_STATUSES

    def test_job_dict_includes_updated_at(self):
        ep = _make_episode("downloading", updated_at=datetime(2026, 3, 18, 12, 0, 0))
        result = _job_dict(ep)
        assert result["updated_at"] == "2026-03-18T12:00:00"

    def test_job_dict_updated_at_none(self):
        ep = _make_episode("pending", updated_at=None)
        result = _job_dict(ep)
        assert result["updated_at"] is None

    def test_job_dict_no_celery_task_id(self):
        """Job dict should not include celery_task_id anymore."""
        ep = _make_episode("pending")
        result = _job_dict(ep)
        assert "celery_task_id" not in result

    def test_done_jobs_included_in_response(self):
        schema = QueueStateResponse.model_json_schema()
        assert "done_count" in schema["properties"]
        assert "done_jobs" in schema["properties"]


class TestRetryJob:
    """Tests for the retry endpoint guard logic (issue #46)."""

    def _call_retry(self, episode):
        """Call retry_job with a mocked DB that returns the given episode."""
        import pytest
        from fastapi import HTTPException

        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = episode
        try:
            with patch("app.api.queue.ingest_episode") as mock_ingest:
                return retry_job("ep-1", db=db)
        except HTTPException as exc:
            return exc

    def test_retry_failed_episode_succeeds(self):
        ep = _make_episode("failed", error_class="TRANSIENT_NETWORK")
        result = self._call_retry(ep)
        assert result["queued"] is True

    def test_retry_stalled_episode_with_error_class_succeeds(self):
        """Stalled jobs with error_class set should be retryable (issue #46)."""
        ep = _make_episode("diarizing", error_class="SYSTEM_ERROR", error_message="Worker killed")
        result = self._call_retry(ep)
        assert result["queued"] is True

    def test_retry_active_episode_without_error_rejected(self):
        """Active jobs without an error should not be retryable."""
        ep = _make_episode("diarizing", error_class=None)
        result = self._call_retry(ep)
        assert result.status_code == 409

    def test_retry_non_retryable_error_rejected(self):
        """Jobs with DISK_FULL or OOM should not be retryable."""
        ep = _make_episode("failed", error_class="DISK_FULL")
        result = self._call_retry(ep)
        assert result.status_code == 422
