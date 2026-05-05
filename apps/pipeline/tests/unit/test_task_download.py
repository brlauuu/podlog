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
    @patch("app.tasks.download.SessionLocal")
    def test_local_url_marks_manual_upload_file_missing(self, mock_session_cls, mock_fail):
        # #650: a local:// URL slipping into download means the manual-upload
        # raw file is gone — surface a dedicated terminal failure with a
        # "re-upload" message instead of letting httpx blow up with
        # UnsupportedProtocol / InvalidURL.
        ep = _make_episode(audio_url="local://Đorđe_and_Lara_talk.mp4")
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        from app.tasks.download import download_episode

        result = download_episode("ep1")

        assert result == "ep1"
        mock_fail.assert_called_once()
        kwargs = mock_fail.call_args.kwargs
        assert kwargs["error_class"] == "MANUAL_UPLOAD_FILE_MISSING"
        assert "Re-upload" in kwargs["error_message"]

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

    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_timeout_propagates_to_worker(
        self, mock_session_cls, mock_update, mock_shutil, mock_dl
    ):
        """Issue #653: download.py no longer catches httpx.TimeoutException; the
        worker's _classify_for_retry handles it as TRANSIENT_NETWORK."""
        import httpx

        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100_000_000_000, 0, 100_000_000_000)
        mock_dl.side_effect = httpx.TimeoutException("timed out")

        with patch("app.tasks.download.Path"):
            from app.tasks.download import download_episode

            with pytest.raises(httpx.TimeoutException):
                download_episode("ep1")

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

    @patch("app.tasks.download.job_queue")
    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_disk_usage_check_oserror_is_non_fatal(
        self, mock_session_cls, mock_update, mock_shutil, mock_dl, mock_jq
    ):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.side_effect = OSError("disk usage unavailable")

        with patch("app.tasks.download.Path"):
            from app.tasks.download import download_episode
            result = download_episode("ep1")

        assert result == "ep1"
        mock_dl.assert_called_once()
        mock_jq.enqueue.assert_called_once()

    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_http_status_error_propagates(
        self, mock_session_cls, mock_update, mock_shutil, mock_dl
    ):
        """Issue #653: HTTP errors propagate; worker classifies + retries."""
        import httpx

        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100_000_000_000, 0, 100_000_000_000)
        req = httpx.Request("GET", "https://example.com/ep.mp3")
        resp = httpx.Response(404, request=req)
        mock_dl.side_effect = httpx.HTTPStatusError("404", request=req, response=resp)

        with patch("app.tasks.download.Path"):
            from app.tasks.download import download_episode

            with pytest.raises(httpx.HTTPStatusError):
                download_episode("ep1")

    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_non_disk_oserror_propagates(
        self, mock_session_cls, mock_update, mock_shutil, mock_dl
    ):
        """Issue #653: only DISK_FULL gets a per-task terminal handler;
        other OSErrors propagate so the worker can classify them."""
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100_000_000_000, 0, 100_000_000_000)
        mock_dl.side_effect = OSError("permission denied")

        with patch("app.tasks.download.Path"):
            from app.tasks.download import download_episode

            with pytest.raises(OSError, match="permission denied"):
                download_episode("ep1")

    @patch("app.tasks.download._download_file")
    @patch("app.tasks.download.shutil")
    @patch("app.tasks.download._update_episode")
    @patch("app.tasks.download.SessionLocal")
    def test_unexpected_exception_propagates(
        self, mock_session_cls, mock_update, mock_shutil, mock_dl
    ):
        """Issue #653: arbitrary exceptions propagate to the worker."""
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_shutil.disk_usage.return_value = DiskUsage(100_000_000_000, 0, 100_000_000_000)
        mock_dl.side_effect = ValueError("bad value")

        with patch("app.tasks.download.Path"):
            from app.tasks.download import download_episode

            with pytest.raises(ValueError, match="bad value"):
                download_episode("ep1")


def test_download_file_updates_progress_and_commits(tmp_path):
    from app.tasks.download import _download_file

    class _Resp:
        headers = {"content-length": "100"}

        def raise_for_status(self):
            return None

        def iter_bytes(self, chunk_size=65536):
            for _ in range(10):
                yield b"x" * 10

    class _StreamCtx:
        def __enter__(self):
            return _Resp()

        def __exit__(self, exc_type, exc, tb):
            return False

    db = MagicMock()
    dest = tmp_path / "ep1.mp3"
    with patch("app.tasks.download.httpx.stream", return_value=_StreamCtx()):
        _download_file("https://example.com/ep.mp3", dest, "ep1", db)

    assert dest.exists()
    assert db.commit.call_count >= 2
    assert db.query.return_value.filter.return_value.update.call_count >= 1


# Issue #653: TestHandleTransientFailure removed. Retry logic moved to the
# worker loop (_handle_task_exception) — see test_worker.py for coverage.
