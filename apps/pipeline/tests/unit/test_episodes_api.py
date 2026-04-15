"""
Unit tests for the episodes API — POST /api/episodes/ingest and /api/episodes/upload.

Coverage target: app/api/episodes.py (was at 34%).
"""
import io
from unittest.mock import MagicMock, patch

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app

client = TestClient(app)


def _override_db(mock_db):
    """Set up FastAPI dependency override for get_db."""
    app.dependency_overrides[get_db] = lambda: mock_db


def _cleanup_db():
    app.dependency_overrides.clear()


class TestIngestEndpoint:
    """POST /api/episodes/ingest"""

    def test_ingest_new_episode(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None

        def refresh_side_effect(obj):
            obj.id = "ep-123"

        mock_db.refresh.side_effect = refresh_side_effect
        _override_db(mock_db)
        try:
            with patch("app.api.episodes.enqueue_episode_ingest") as mock_ingest:
                resp = client.post("/api/episodes/ingest", json={
                    "audio_url": "https://example.com/episode.mp3",
                    "title": "Test Episode",
                })

                assert resp.status_code == 202
                data = resp.json()
                assert data["episode_id"] == "ep-123"
                mock_db.add.assert_called_once()
                mock_db.commit.assert_called_once()
                mock_ingest.assert_called_once_with(mock_db, "ep-123")
        finally:
            _cleanup_db()

    def test_ingest_duplicate_returns_409(self):
        mock_db = MagicMock()
        existing = MagicMock()
        existing.id = "existing-ep"
        mock_db.query.return_value.filter.return_value.first.return_value = existing
        _override_db(mock_db)
        try:
            resp = client.post("/api/episodes/ingest", json={
                "audio_url": "https://example.com/episode.mp3",
            })

            assert resp.status_code == 409
            assert "already ingested" in resp.json()["detail"].lower()
        finally:
            _cleanup_db()

    def test_ingest_uses_url_as_default_title(self):
        mock_db = MagicMock()
        mock_db.query.return_value.filter.return_value.first.return_value = None

        def refresh_side_effect(obj):
            obj.id = "ep-123"

        mock_db.refresh.side_effect = refresh_side_effect
        _override_db(mock_db)
        try:
            with patch("app.api.episodes.enqueue_episode_ingest"):
                resp = client.post("/api/episodes/ingest", json={
                    "audio_url": "https://example.com/ep.mp3",
                })

                assert resp.status_code == 202
                added_episode = mock_db.add.call_args[0][0]
                assert added_episode.title == "https://example.com/ep.mp3"
        finally:
            _cleanup_db()


class TestUploadEndpoint:
    """POST /api/episodes/upload"""

    def test_upload_valid_mp3(self):
        mock_db = MagicMock()
        mock_db.flush.return_value = None

        def refresh_side_effect(obj):
            obj.id = "ep-upload-1"

        mock_db.refresh.side_effect = refresh_side_effect
        _override_db(mock_db)
        try:
            with patch("app.api.episodes.settings") as mock_settings, \
                 patch("app.api.episodes.job_queue") as mock_jq, \
                 patch("builtins.open", create=True), \
                 patch("shutil.copyfileobj"), \
                 patch("shutil.disk_usage") as mock_disk, \
                 patch("pathlib.Path.mkdir"):
                mock_settings.data_dir = "/tmp/test-data"
                mock_settings.disk_headroom_bytes = 0
                mock_settings.audio_raw_dir = "/tmp/test-data/audio/raw"
                mock_disk.return_value = MagicMock(free=10_000_000_000)

                resp = client.post(
                    "/api/episodes/upload",
                    files={"file": ("my_podcast.mp3", io.BytesIO(b"fake mp3"), "audio/mpeg")},
                    data={"title": "My Podcast Episode"},
                )

            assert resp.status_code == 202
            assert "episode_id" in resp.json()
            mock_db.add.assert_called_once()
            mock_db.commit.assert_called_once()
            mock_jq.enqueue.assert_called_once()
        finally:
            _cleanup_db()

    def test_upload_valid_mp4(self):
        """MP4 files (often containing audio) should be accepted for upload. Issue #441"""
        mock_db = MagicMock()
        mock_db.flush.return_value = None

        def refresh_side_effect(obj):
            obj.id = "ep-upload-mp4"

        mock_db.refresh.side_effect = refresh_side_effect
        _override_db(mock_db)
        try:
            with patch("app.api.episodes.settings") as mock_settings, \
                 patch("app.api.episodes.job_queue") as mock_jq, \
                 patch("builtins.open", create=True), \
                 patch("shutil.copyfileobj"), \
                 patch("shutil.disk_usage") as mock_disk, \
                 patch("pathlib.Path.mkdir"):
                mock_settings.data_dir = "/tmp/test-data"
                mock_settings.disk_headroom_bytes = 0
                mock_settings.audio_raw_dir = "/tmp/test-data/audio/raw"
                mock_disk.return_value = MagicMock(free=10_000_000_000)

                resp = client.post(
                    "/api/episodes/upload",
                    files={"file": ("video_podcast.mp4", io.BytesIO(b"fake mp4 video with audio"), "video/mp4")},
                    data={"title": "Video Podcast Episode"},
                )

            assert resp.status_code == 202
            assert "episode_id" in resp.json()
            mock_db.add.assert_called_once()
            mock_db.commit.assert_called_once()
            mock_jq.enqueue.assert_called_once()
        finally:
            _cleanup_db()

    def test_upload_rejects_unsupported_extension(self):
        mock_db = MagicMock()
        _override_db(mock_db)
        try:
            resp = client.post(
                "/api/episodes/upload",
                files={"file": ("doc.pdf", io.BytesIO(b"not audio"), "application/pdf")},
            )

            assert resp.status_code == 400
            assert "Unsupported file type" in resp.json()["detail"]
        finally:
            _cleanup_db()

    def test_upload_rejects_when_disk_full(self):
        mock_db = MagicMock()
        _override_db(mock_db)
        try:
            with patch("app.api.episodes.settings") as mock_settings, \
                 patch("shutil.disk_usage") as mock_disk:
                mock_settings.data_dir = "/tmp/test-data"
                mock_settings.disk_headroom_bytes = 999_999_999_999
                mock_disk.return_value = MagicMock(free=100)

                resp = client.post(
                    "/api/episodes/upload",
                    files={"file": ("ep.mp3", io.BytesIO(b"data"), "audio/mpeg")},
                )

            assert resp.status_code == 507
            assert "disk space" in resp.json()["detail"].lower()
        finally:
            _cleanup_db()

    def test_upload_uses_filename_as_default_title(self):
        mock_db = MagicMock()
        mock_db.flush.return_value = None

        def refresh_side_effect(obj):
            obj.id = "ep-1"

        mock_db.refresh.side_effect = refresh_side_effect
        _override_db(mock_db)
        try:
            with patch("app.api.episodes.settings") as mock_settings, \
                 patch("app.api.episodes.job_queue"), \
                 patch("builtins.open", create=True), \
                 patch("shutil.copyfileobj"), \
                 patch("shutil.disk_usage") as mock_disk, \
                 patch("pathlib.Path.mkdir"):
                mock_settings.data_dir = "/tmp/test-data"
                mock_settings.disk_headroom_bytes = 0
                mock_settings.audio_raw_dir = "/tmp/test-data/audio/raw"
                mock_disk.return_value = MagicMock(free=10_000_000_000)

                resp = client.post(
                    "/api/episodes/upload",
                    files={"file": ("my_great-episode.wav", io.BytesIO(b"data"), "audio/wav")},
                )

            assert resp.status_code == 202
            added_episode = mock_db.add.call_args[0][0]
            assert added_episode.title == "my great episode"
        finally:
            _cleanup_db()

    def test_upload_enqueues_transcribe_not_download(self):
        """Upload skips download — file is already local."""
        mock_db = MagicMock()
        mock_db.flush.return_value = None

        def refresh_side_effect(obj):
            obj.id = "ep-1"

        mock_db.refresh.side_effect = refresh_side_effect
        _override_db(mock_db)
        try:
            with patch("app.api.episodes.settings") as mock_settings, \
                 patch("app.api.episodes.job_queue") as mock_jq, \
                 patch("builtins.open", create=True), \
                 patch("shutil.copyfileobj"), \
                 patch("shutil.disk_usage") as mock_disk, \
                 patch("pathlib.Path.mkdir"):
                mock_settings.data_dir = "/tmp/test-data"
                mock_settings.disk_headroom_bytes = 0
                mock_settings.audio_raw_dir = "/tmp/test-data/audio/raw"
                mock_disk.return_value = MagicMock(free=10_000_000_000)

                client.post(
                    "/api/episodes/upload",
                    files={"file": ("ep.mp3", io.BytesIO(b"data"), "audio/mpeg")},
                )

            mock_jq.enqueue.assert_called_once()
            assert mock_jq.enqueue.call_args[0][2] == "transcribe"
        finally:
            _cleanup_db()

    def test_upload_no_filename_returns_error(self):
        """Empty filename should be rejected (FastAPI validation or our check)."""
        mock_db = MagicMock()
        _override_db(mock_db)
        try:
            resp = client.post(
                "/api/episodes/upload",
                files={"file": ("", io.BytesIO(b"data"), "audio/mpeg")},
            )
            # FastAPI may return 422 (validation) or our handler returns 400
            assert resp.status_code in (400, 422)
        finally:
            _cleanup_db()
