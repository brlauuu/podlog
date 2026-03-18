"""Tests for the queue API response structure."""
from datetime import datetime
from unittest.mock import MagicMock

from app.api.queue import ACTIVE_STATUSES, QueueStateResponse, _job_dict


def _make_episode(status, **kwargs):
    """Create a mock Episode with required fields."""
    ep = MagicMock()
    ep.id = kwargs.get("id", "ep-1")
    ep.title = kwargs.get("title", "Test Episode")
    ep.status = status
    ep.celery_task_id = kwargs.get("celery_task_id", "task-1")
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

    def test_done_jobs_included_in_response(self):
        schema = QueueStateResponse.model_json_schema()
        assert "done_count" in schema["properties"]
        assert "done_jobs" in schema["properties"]
