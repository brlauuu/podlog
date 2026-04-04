"""Tests for the queue API retry logic."""
from unittest.mock import MagicMock, patch

from app.api.queue import NON_RETRYABLE, retry_job
from app.models import Episode, Job


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


class TestNonRetryable:
    def test_disk_full_is_non_retryable(self):
        assert "DISK_FULL" in NON_RETRYABLE

    def test_oom_is_non_retryable(self):
        assert "OOM" in NON_RETRYABLE


class TestRetryJob:
    """Tests for the retry endpoint guard logic (issue #46)."""

    def _call_retry(self, episode, has_active_job=False):
        """Call retry_job with a mocked DB that returns the given episode."""
        from fastapi import HTTPException

        db = MagicMock()

        # db.query(Episode).filter(...).first() returns the episode
        # db.query(Job).filter(...).first() returns None (no active job) or a mock
        def query_side_effect(model):
            chain = MagicMock()
            if model is Episode:
                chain.filter.return_value.first.return_value = episode
            elif model is Job:
                chain.filter.return_value.first.return_value = MagicMock() if has_active_job else None
            return chain

        db.query.side_effect = query_side_effect
        try:
            with patch("app.api.queue.ingest_episode"):
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

    def test_retry_done_episode_succeeds(self):
        """Done episodes (e.g. with diarization failure) should be reprocessable."""
        ep = _make_episode("done")
        result = self._call_retry(ep)
        assert result["queued"] is True

    def test_retry_active_episode_without_error_rejected(self):
        """Active jobs with a queue entry should not be retryable."""
        ep = _make_episode("diarizing", error_class=None)
        result = self._call_retry(ep, has_active_job=True)
        assert result.status_code == 409

    def test_retry_non_retryable_error_rejected(self):
        """Jobs with DISK_FULL or OOM should not be retryable."""
        ep = _make_episode("failed", error_class="DISK_FULL")
        result = self._call_retry(ep)
        assert result.status_code == 422

    def test_retry_done_non_retryable_rejected(self):
        """Done episodes with non-retryable error class should still be rejected."""
        ep = _make_episode("done", error_class="DISK_FULL")
        result = self._call_retry(ep)
        assert result.status_code == 422

    def test_retry_stuck_episode_no_queue_entry_succeeds(self):
        """Stuck episodes (intermediate status, no queue entry) should be retryable."""
        ep = _make_episode("archiving")
        result = self._call_retry(ep, has_active_job=False)
        assert result["queued"] is True

    def test_retry_active_episode_with_queue_entry_rejected(self):
        """Episodes with an active queue entry should not be retryable."""
        ep = _make_episode("transcribing")
        result = self._call_retry(ep, has_active_job=True)
        assert result.status_code == 409
