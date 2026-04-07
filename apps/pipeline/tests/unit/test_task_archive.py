"""Unit tests for app.tasks.archive — archive task."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, PropertyMock

import pytest


def _make_episode(id_="ep1", title="Test Episode", audio_path="/data/audio/raw/ep1.mp3",
                  has_diarization=True, diarization_error=None, feed=None,
                  transcribe_duration_secs=30.0, diarize_duration_secs=20.0,
                  duration_secs=600, published_at=None):
    ep = MagicMock()
    ep.id = id_
    ep.title = title
    ep.audio_local_path = audio_path
    ep.has_diarization = has_diarization
    ep.diarization_error = diarization_error
    ep.feed = feed
    ep.feed_id = feed.id if feed else None
    ep.transcribe_duration_secs = transcribe_duration_secs
    ep.diarize_duration_secs = diarize_duration_secs
    ep.duration_secs = duration_secs
    ep.published_at = published_at
    return ep


def _make_segment(id_=1, start=0.0, end=5.0, text="hello", speaker="SPEAKER_00"):
    seg = MagicMock()
    seg.id = id_
    seg.start_time = start
    seg.end_time = end
    seg.text = text
    seg.speaker_label = speaker
    return seg


def _make_speaker_name(speaker_label="SPEAKER_00", display_name="Host", inferred=True):
    sn = MagicMock()
    sn.speaker_label = speaker_label
    sn.display_name = display_name
    sn.inferred = inferred
    return sn


class TestArchiveEpisode:
    @patch("app.tasks.archive.bus")
    @patch("app.tasks.archive.compute_avg_duration", return_value=1800.0)
    @patch("app.tasks.archive.estimate_queue_status", return_value=(0, 0, None))
    @patch("app.tasks.archive.compute_avg_processing_stats", return_value=(30, 20, 50))
    @patch("app.tasks.archive.update_episode")
    @patch("app.tasks.archive.SessionLocal")
    def test_happy_path(self, mock_session_cls, mock_update, mock_avg, mock_queue, mock_avg_dur, mock_bus):
        ep = _make_episode()
        seg = _make_segment()
        sn = _make_speaker_name()
        db = MagicMock()

        # first() calls: episode lookup, then verified lookup
        verified_ep = MagicMock()
        verified_ep.status = "done"
        db.query.return_value.filter.return_value.first.side_effect = [ep, verified_ep]
        # Segments query
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [seg]
        # Speaker names query - need to handle the second .filter().all() call
        db.query.return_value.filter.return_value.all.return_value = [sn]
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.archive.settings") as mock_settings,
            patch("app.tasks.archive._compress_audio", return_value="/data/audio/archive/ep1.mp3"),
            patch("app.tasks.archive._write_transcript", return_value="/data/transcripts/ep1.txt"),
            patch("pathlib.Path.exists", return_value=True),
            patch("pathlib.Path.unlink"),
        ):
            mock_settings.archive_audio = True

            from app.tasks.archive import archive_episode

            result = archive_episode("ep1")

        assert result == "ep1"
        mock_update.assert_any_call(db, "ep1", status="archiving")
        mock_bus.emit.assert_called_once()

    @patch("app.tasks.archive.mark_failed")
    @patch("app.tasks.archive.update_episode")
    @patch("app.tasks.archive.SessionLocal")
    def test_no_segments_fails(self, mock_session_cls, mock_update, mock_mark_failed):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []
        db.query.return_value.filter.return_value.all.return_value = []
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.archive.settings") as mock_settings,
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.archive_audio = False

            from app.tasks.archive import archive_episode

            result = archive_episode("ep1")

        assert result == "ep1"
        mock_mark_failed.assert_called_once_with(
            db, "ep1", error_class="SYSTEM_ERROR",
            error_message="No transcript segments found at archival -- cannot mark done.",
        )

    @patch("app.tasks.archive.mark_failed")
    @patch("app.tasks.archive.update_episode")
    @patch("app.tasks.archive.SessionLocal")
    def test_disk_full_during_compress(self, mock_session_cls, mock_update, mock_mark_failed):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.archive.settings") as mock_settings,
            patch("app.tasks.archive._compress_audio", side_effect=OSError(28, "No space left on device")),
            patch("pathlib.Path.exists", return_value=True),
            patch("pathlib.Path.__new__") as mock_path_new,
        ):
            mock_settings.archive_audio = True

            from app.tasks.archive import archive_episode

            result = archive_episode("ep1")

        assert result == "ep1"
        mock_mark_failed.assert_called_once_with(
            db, "ep1", error_class="DISK_FULL",
            error_message="Disk full during archival. Free space and retry.",
        )

    @patch("app.tasks.archive.SessionLocal")
    def test_missing_episode_raises(self, mock_session_cls):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        mock_session_cls.return_value = db

        from app.tasks.archive import archive_episode

        with pytest.raises(RuntimeError, match="not found"):
            archive_episode("ep1")


    def test_compress_skips_when_already_in_archive_dir(self, tmp_path):
        """_compress_audio should skip ffmpeg when source is already the dest."""
        archive_dir = tmp_path / "archive"
        archive_dir.mkdir()
        existing = archive_dir / "ep1.mp3"
        existing.write_bytes(b"fake-mp3-data")

        with patch("app.tasks.archive.settings") as mock_settings:
            mock_settings.audio_archive_dir = str(archive_dir)

            from app.tasks.archive import _compress_audio

            result = _compress_audio(existing, "ep1")

        assert result == existing
        # File should be unchanged (no ffmpeg ran)
        assert existing.read_bytes() == b"fake-mp3-data"


class TestWriteTranscript:
    def test_writes_with_speaker_labels(self):
        ep = MagicMock()
        ep.id = "ep1"
        ep.title = "Test Episode"
        ep.has_diarization = True
        ep.diarization_error = None

        seg = MagicMock()
        seg.start_time = 0.0
        seg.end_time = 5.5
        seg.text = "Hello there"
        seg.speaker_label = "SPEAKER_00"

        sn = MagicMock()
        sn.display_name = "Host"
        sn.inferred = True
        name_map = {"SPEAKER_00": sn}

        with (
            patch("app.tasks.archive.settings") as mock_settings,
            patch("app.tasks.archive.Path") as mock_path,
        ):
            mock_settings.transcript_dir = "/data/transcripts"
            mock_dest = MagicMock()
            mock_path.return_value.__truediv__ = lambda self, x: mock_dest
            mock_path.return_value.mkdir = MagicMock()

            from app.tasks.archive import _write_transcript

            result = _write_transcript(ep, [seg], name_map)

        mock_dest.write_text.assert_called_once()
        written = mock_dest.write_text.call_args[0][0]
        assert "Host" in written
        assert "Hello there" in written

    def test_writes_without_diarization(self):
        ep = MagicMock()
        ep.id = "ep1"
        ep.title = "Test"
        ep.has_diarization = False
        ep.diarization_error = "pyannote failed"

        seg = MagicMock()
        seg.start_time = 0.0
        seg.end_time = 5.0
        seg.text = "Hello"
        seg.speaker_label = None

        with (
            patch("app.tasks.archive.settings") as mock_settings,
            patch("app.tasks.archive.Path") as mock_path,
        ):
            mock_settings.transcript_dir = "/data/transcripts"
            mock_dest = MagicMock()
            mock_path.return_value.__truediv__ = lambda self, x: mock_dest
            mock_path.return_value.mkdir = MagicMock()

            from app.tasks.archive import _write_transcript

            result = _write_transcript(ep, [seg], {})

        mock_dest.write_text.assert_called_once()
        written = mock_dest.write_text.call_args[0][0]
        assert "FAILED" in written
        assert "Hello" in written
