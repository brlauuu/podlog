"""Unit tests for app.services.pipeline_commands (#556, #650)."""
from pathlib import Path
from unittest.mock import MagicMock, patch

from app.services.pipeline_commands import (
    _is_manual_upload,
    enqueue_episode_ingest,
    run_chunk_backfill,
)


def _episode(*, audio_url: str | None, audio_local_path: str | None):
    ep = MagicMock()
    ep.audio_url = audio_url
    ep.audio_local_path = audio_local_path
    return ep


def _db_returning(episode):
    """Fake Session whose first() returns the supplied Episode."""
    db = MagicMock()
    db.query.return_value.filter.return_value.first.return_value = episode
    return db


class TestEnqueueEpisodeIngest:
    def test_rss_episode_starts_at_download(self):
        rss = _episode(
            audio_url="https://example.com/ep.mp3",
            audio_local_path=None,
        )
        db = _db_returning(rss)
        with patch("app.services.pipeline_commands.job_queue.enqueue") as mock_enqueue:
            enqueue_episode_ingest(db, "ep-123")
        mock_enqueue.assert_called_once_with(db, "ep-123", "download")

    def test_manual_upload_skips_download_and_starts_at_transcribe(self, tmp_path: Path):
        # #650: manually-uploaded episodes already have a local file. Routing
        # them through download feeds the synthetic local:// URL to httpx,
        # which trips IDNA encoding on non-ASCII filenames.
        local_file = tmp_path / "abc.mp4"
        local_file.write_bytes(b"audio")
        upload = _episode(
            audio_url="local://Đorđe_and_Lara_talk.mp4",
            audio_local_path=str(local_file),
        )
        db = _db_returning(upload)
        with patch("app.services.pipeline_commands.job_queue.enqueue") as mock_enqueue:
            enqueue_episode_ingest(db, "ep-upload")
        mock_enqueue.assert_called_once_with(db, "ep-upload", "transcribe")

    def test_unknown_episode_falls_through_to_download(self):
        # If the row isn't found at all, fall through — the download task
        # will surface the "Episode not found" error in the standard way.
        db = _db_returning(None)
        with patch("app.services.pipeline_commands.job_queue.enqueue") as mock_enqueue:
            enqueue_episode_ingest(db, "missing")
        mock_enqueue.assert_called_once_with(db, "missing", "download")


class TestIsManualUpload:
    def test_local_url_with_existing_file(self, tmp_path: Path):
        f = tmp_path / "a.mp3"
        f.write_bytes(b"x")
        ep = _episode(audio_url="local://a.mp3", audio_local_path=str(f))
        assert _is_manual_upload(ep) is True

    def test_local_url_but_file_missing(self, tmp_path: Path):
        ep = _episode(
            audio_url="local://a.mp3",
            audio_local_path=str(tmp_path / "missing.mp3"),
        )
        assert _is_manual_upload(ep) is False

    def test_no_local_path(self):
        ep = _episode(audio_url="local://a.mp3", audio_local_path=None)
        assert _is_manual_upload(ep) is False

    def test_rss_url_with_local_path_is_not_an_upload(self, tmp_path: Path):
        # RSS download writes audio_local_path too; the local:// scheme is
        # what disambiguates an upload.
        f = tmp_path / "a.mp3"
        f.write_bytes(b"x")
        ep = _episode(
            audio_url="https://example.com/a.mp3",
            audio_local_path=str(f),
        )
        assert _is_manual_upload(ep) is False


def test_run_chunk_backfill_default_embed_true():
    with patch("app.tasks.backfill_chunks.backfill_chunks") as mock_backfill:
        mock_backfill.return_value = {"processed": 5}
        result = run_chunk_backfill()
        mock_backfill.assert_called_once_with(embed=True)
        assert result == {"processed": 5}


def test_run_chunk_backfill_explicit_embed_false():
    with patch("app.tasks.backfill_chunks.backfill_chunks") as mock_backfill:
        mock_backfill.return_value = {"processed": 0}
        run_chunk_backfill(embed=False)
        mock_backfill.assert_called_once_with(embed=False)
