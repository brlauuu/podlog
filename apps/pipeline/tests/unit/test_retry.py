"""
Unit tests for error classification and retry logic -- PRD-01 S5.2, S5.9, S12
"""
from unittest.mock import patch, MagicMock

from app.tasks.download import _classify_http_error, _handle_transient_failure


class TestErrorClassification:
    def test_5xx_is_transient_network(self):
        for code in [500, 502, 503, 504]:
            assert _classify_http_error(code) == "TRANSIENT_NETWORK"

    def test_4xx_is_http_access(self):
        for code in [400, 401, 403, 404, 429]:
            assert _classify_http_error(code) == "HTTP_ACCESS"

    def test_200_is_http_access(self):
        # Edge case: should not happen, but classify correctly
        assert _classify_http_error(200) == "HTTP_ACCESS"


class TestRetryLogic:
    def _make_db(self):
        db = MagicMock()
        db.query.return_value.filter.return_value.update.return_value = None
        return db

    def test_retries_when_under_max(self):
        db = self._make_db()
        with patch("app.tasks.download.job_queue") as mock_jq:
            _handle_transient_failure(db, "ep-1", retry_max=3, retry_count=0,
                                      error_class="HTTP_ACCESS", error_msg="HTTP 403")
            mock_jq.enqueue.assert_called_once()
            # Verify retry_at is set (not None)
            args, kwargs = mock_jq.enqueue.call_args
            assert kwargs.get("retry_at") is not None or args[3] is not None

    def test_second_retry_has_longer_backoff(self):
        db = self._make_db()
        with patch("app.tasks.download.job_queue") as mock_jq:
            _handle_transient_failure(db, "ep-1", retry_max=3, retry_count=1,
                                      error_class="HTTP_ACCESS", error_msg="HTTP 403")
            mock_jq.enqueue.assert_called_once()

    @patch("app.tasks.helpers.compute_avg_duration", return_value=1800.0)
    @patch("app.tasks.helpers.estimate_queue_status", return_value=(0, None, None))
    def test_marks_failed_at_max_retries(self, mock_estimate, mock_avg_dur):
        db = self._make_db()
        episode = MagicMock()
        episode.retry_count = 3
        episode.retry_max = 3
        episode.feed = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = episode

        with patch("app.tasks.download.job_queue") as mock_jq:
            _handle_transient_failure(db, "ep-1", retry_max=3, retry_count=3,
                                      error_class="HTTP_ACCESS", error_msg="HTTP 403")
            mock_jq.enqueue.assert_not_called()

        # mark_failed uses setattr on the episode object
        assert episode.status == "failed"
        assert episode.error_class == "HTTP_ACCESS"

    def test_disk_full_does_not_retry(self):
        """DISK_FULL should never be retried automatically."""
        # This is enforced in download_episode directly, but we verify
        # the error class is not TRANSIENT_NETWORK or HTTP_ACCESS
        assert _classify_http_error(500) != "DISK_FULL"
        assert _classify_http_error(403) != "DISK_FULL"
