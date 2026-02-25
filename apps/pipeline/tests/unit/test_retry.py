"""
Unit tests for error classification and retry logic — PRD-01 §5.2, §5.9, §12
"""
import pytest
from unittest.mock import patch, MagicMock, call

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
        with patch("app.tasks.download.download_episode") as mock_task:
            mock_task.apply_async = MagicMock()
            _handle_transient_failure(db, "ep-1", retry_max=3, retry_count=0,
                                      error_class="HTTP_ACCESS", error_msg="HTTP 403")
            mock_task.apply_async.assert_called_once()
            # First retry backoff: 30 * 2^0 = 30s
            args, kwargs = mock_task.apply_async.call_args
            assert kwargs["countdown"] == 30

    def test_second_retry_has_longer_backoff(self):
        db = self._make_db()
        with patch("app.tasks.download.download_episode") as mock_task:
            mock_task.apply_async = MagicMock()
            _handle_transient_failure(db, "ep-1", retry_max=3, retry_count=1,
                                      error_class="HTTP_ACCESS", error_msg="HTTP 403")
            args, kwargs = mock_task.apply_async.call_args
            assert kwargs["countdown"] == 60  # 30 * 2^1

    def test_marks_failed_at_max_retries(self):
        db = self._make_db()
        with patch("app.tasks.download.download_episode") as mock_task:
            mock_task.apply_async = MagicMock()
            _handle_transient_failure(db, "ep-1", retry_max=3, retry_count=3,
                                      error_class="HTTP_ACCESS", error_msg="HTTP 403")
            mock_task.apply_async.assert_not_called()

            # Assert failed status was written
            update_call = db.query.return_value.filter.return_value.update
            call_kwargs = update_call.call_args[0][0]
            assert call_kwargs["status"] == "failed"
            assert call_kwargs["error_class"] == "HTTP_ACCESS"

    def test_disk_full_does_not_retry(self):
        """DISK_FULL should never be retried automatically."""
        # This is enforced in download_episode directly, but we verify
        # the error class is not TRANSIENT_NETWORK or HTTP_ACCESS
        assert _classify_http_error(500) != "DISK_FULL"
        assert _classify_http_error(403) != "DISK_FULL"
