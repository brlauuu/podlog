"""Unit tests for app.tasks.download — episode download task."""
from unittest.mock import MagicMock, patch, PropertyMock
from collections import namedtuple

import pytest


DiskUsage = namedtuple("DiskUsage", ["total", "used", "free"])


def _make_episode(id_="ep1", audio_url="https://example.com/ep.mp3", retry_count=0, retry_max=3):
    ep = MagicMock()
    ep.id = id_
    ep.audio_url = audio_url
    ep.retry_count = retry_count
    ep.retry_max = retry_max
    return ep


class TestClassifyHttpError:
    def test_transient_codes(self):
        from app.tasks.download import _classify_http_error

        for code in (500, 502, 503, 504):
            assert _classify_http_error(code) == "TRANSIENT_NETWORK"

    def test_non_transient_codes(self):
        from app.tasks.download import _classify_http_error

        for code in (403, 404, 410, 301):
            assert _classify_http_error(code) == "HTTP_ACCESS"


class TestDownloadEpisode:
    @patch("app.tasks.download.job_queue")
    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_happy_path(self, mock_session_cls, mock_update, mock_shutil, mock_dl, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100_000_000_000, 0, 100_000_000_000)

        with patch("app.tasks.download.Path") as mock_path:
            mock_path.return_value.suffix = ".mp3"
            mock_path.return_value.__truediv__ = lambda self, other: MagicMock(__str__=lambda s: f"/data/{other}")

            from app.tasks.download import download_episode

            result = download_episode("ep1")

        assert result == "ep1"
        mock_dl.assert_called_once()
        mock_jq.enqueue.assert_called_once()

    @patch("app.tasks.download.mark_failed")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_disk_full_precheck(self, mock_session_cls, mock_update, mock_shutil, mock_fail):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100, 99, 1)

        with patch("app.tasks.download.settings") as mock_settings:
            mock_settings.data_dir = "/data"
            mock_settings.disk_headroom_bytes = 1_000_000_000

            from app.tasks.download import download_episode

            result = download_episode("ep1")

        assert result == "ep1"
        mock_fail.assert_called_once()
        assert mock_fail.call_args[1]["error_class"] == "DISK_FULL" or mock_fail.call_args[0][2] == "DISK_FULL"

    @patch("app.tasks.download.job_queue")
    @patch("app.tasks.download._handle_transient_failure")
    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_timeout_triggers_retry(self, mock_session_cls, mock_update, mock_shutil, mock_dl, mock_handle, mock_jq):
        import httpx

        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100_000_000_000, 0, 100_000_000_000)
        mock_dl.side_effect = httpx.TimeoutException("timed out")

        with patch("app.tasks.download.Path"):
            from app.tasks.download import download_episode

            result = download_episode("ep1")

        assert result == "ep1"
        mock_handle.assert_called_once()
        assert mock_handle.call_args[0][4] == "TRANSIENT_NETWORK"

    @patch("app.tasks.download.mark_failed")
    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_disk_full_during_download(self, mock_session_cls, mock_update, mock_shutil, mock_dl, mock_fail):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100_000_000_000, 0, 100_000_000_000)
        mock_dl.side_effect = OSError(28, "No space left on device")

        with patch("app.tasks.download.Path"):
            from app.tasks.download import download_episode

            result = download_episode("ep1")

        assert result == "ep1"
        mock_fail.assert_called_once()
        args = mock_fail.call_args
        assert "DISK_FULL" in str(args)

    @patch("app.tasks.download.SessionLocal")
    def test_missing_episode_raises(self, mock_session_cls):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        mock_session_cls.return_value = db

        from app.tasks.download import download_episode

        with pytest.raises(RuntimeError, match="not found"):
            download_episode("ep1")


class TestHandleTransientFailure:
    @patch("app.tasks.download.job_queue")
    @patch("app.tasks.download._update_episode")
    def test_retry_when_under_max(self, mock_update, mock_jq):
        db = MagicMock()

        with patch("app.tasks.download.settings") as mock_settings:
            mock_settings.retry_backoff_base = 60

            from app.tasks.download import _handle_transient_failure

            _handle_transient_failure(db, "ep1", 3, 0, "TRANSIENT_NETWORK", "timeout")

        mock_update.assert_called_once()
        mock_jq.enqueue.assert_called_once()

    @patch("app.tasks.download.mark_failed")
    @patch("app.tasks.download._update_episode")
    def test_fail_when_at_max(self, mock_update, mock_fail):
        db = MagicMock()

        from app.tasks.download import _handle_transient_failure

        _handle_transient_failure(db, "ep1", 3, 3, "TRANSIENT_NETWORK", "timeout")

        mock_fail.assert_called_once()
