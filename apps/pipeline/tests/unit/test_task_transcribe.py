"""Unit tests for app.tasks.transcribe — transcription task."""
import gc
from unittest.mock import MagicMock, patch, call
from pathlib import Path

import pytest


def _make_episode(id_="ep1", audio_path="/data/audio/raw/ep1.mp3", status="downloading"):
    ep = MagicMock()
    ep.id = id_
    ep.audio_local_path = audio_path
    ep.status = status
    return ep


class TestTranscribeEpisode:
    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._unload_whisper")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_happy_path(self, mock_session_cls, mock_convert, mock_unload, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        db.query.return_value.filter.return_value.delete.return_value = 0
        mock_session_cls.return_value = db

        segments_data = [{"start": 0.0, "end": 5.0, "text": " hello "}]
        aligned_result = {"segments": []}

        with (
            patch("app.services.whisper.transcribe", return_value=(segments_data, "en", aligned_result)),
            patch("app.tasks.transcribe.settings") as mock_settings,
            patch("builtins.open", MagicMock()),
            patch("app.tasks.transcribe.json"),
        ):
            mock_settings.whisper_model = "large-v3-turbo"
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_called_once()
        mock_unload.assert_called_once()
        mock_update.assert_any_call(db, "ep1", status="transcribing")
        mock_update.assert_any_call(db, "ep1", language="en", status="diarizing")
        db.add.assert_called_once()
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "diarize")

    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_idempotency_skip_if_already_past_transcribing(self, mock_session_cls, mock_update):
        for status in ("diarizing", "inferring", "archiving", "done"):
            ep = _make_episode(status=status)
            db = MagicMock()
            db.query.return_value.filter.return_value.first.return_value = ep
            mock_session_cls.return_value = db

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

            assert result == "ep1"
            mock_update.assert_not_called()
            mock_update.reset_mock()

    @patch("app.tasks.transcribe._unload_whisper")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe._mark_failed")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_ffmpeg_failure_marks_system_error(self, mock_session_cls, mock_update, mock_fail, mock_convert, mock_unload):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_convert.side_effect = RuntimeError("ffmpeg crash")

        from app.tasks.transcribe import transcribe_episode

        result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_fail.assert_called_once()
        assert "SYSTEM_ERROR" in str(mock_fail.call_args)

    @patch("app.tasks.transcribe._unload_whisper")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe._mark_failed")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_oom_marks_oom_error(self, mock_session_cls, mock_update, mock_fail, mock_convert, mock_unload):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch("app.services.whisper.transcribe", side_effect=MemoryError("out of memory")),
            patch("app.tasks.transcribe.settings") as mock_settings,
        ):
            mock_settings.whisper_model = "large-v3-turbo"

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_fail.assert_called_once()
        assert "OOM" in str(mock_fail.call_args)
        mock_unload.assert_called_once()

    @patch("app.tasks.transcribe.SessionLocal")
    def test_missing_episode_raises(self, mock_session_cls):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        mock_session_cls.return_value = db

        from app.tasks.transcribe import transcribe_episode

        with pytest.raises(RuntimeError, match="not found"):
            transcribe_episode("ep1")

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_provider_path(self, mock_session_cls, mock_convert, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        db.query.return_value.filter.return_value.delete.return_value = 0
        mock_session_cls.return_value = db

        segments_data = [{"start": 0.0, "end": 5.0, "text": "hello"}]
        fireworks_raw = {"segments": segments_data, "words": []}

        with (
            patch(
                "app.services.fireworks_audio.transcribe",
                return_value=(segments_data, "en", fireworks_raw),
            ),
            patch(
                "app.tasks.transcribe.get_runtime_inference_settings",
                return_value={
                    "inference_provider": "fireworks",
                    "fireworks_api_key": "fw_test",
                    "fireworks_audio_base_url": "https://audio-turbo.api.fireworks.ai",
                    "fireworks_stt_model": "whisper-v3-large",
                    "fireworks_stt_diarize": True,
                },
            ),
            patch("app.tasks.transcribe.settings") as mock_settings,
            patch("builtins.open", MagicMock()),
            patch("app.tasks.transcribe.json"),
        ):
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_not_called()
        mock_update.assert_any_call(db, "ep1", status="transcribing")
        mock_update.assert_any_call(db, "ep1", language="en", status="diarizing")
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "diarize")
