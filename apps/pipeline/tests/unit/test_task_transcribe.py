"""Unit tests for app.tasks.transcribe — transcription task."""
import gc
from unittest.mock import MagicMock, patch, call
from pathlib import Path

import pytest
from app.services.fireworks_audio import FireworksTranscriptionError


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
            patch("app.tasks.transcribe_helpers.json"),
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
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_ffmpeg_failure_propagates(self, mock_session_cls, mock_update, mock_convert, mock_unload):
        """Issue #653: ffmpeg failures propagate; worker classifies as SYSTEM_ERROR."""
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db
        mock_convert.side_effect = RuntimeError("ffmpeg crash")

        from app.tasks.transcribe import transcribe_episode

        with pytest.raises(RuntimeError, match="ffmpeg crash"):
            transcribe_episode("ep1")

    @patch("app.tasks.transcribe._unload_whisper")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_oom_propagates_and_unloads_whisper(
        self, mock_session_cls, mock_update, mock_convert, mock_unload
    ):
        """Issue #653: MemoryError propagates; worker classifies as OOM.
        The Whisper unload still runs via the finally clause (PRD-01 §5.4)."""
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

            with pytest.raises(MemoryError, match="out of memory"):
                transcribe_episode("ep1")

        # Mandatory cleanup still runs even when an exception propagates.
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
                    "fireworks_stt_cost_per_minute_usd": 0.01,
                },
            ),
            patch("app.tasks.transcribe.settings") as mock_settings,
            patch("builtins.open", MagicMock()),
            patch("app.tasks.transcribe_helpers.json"),
        ):
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_not_called()
        mock_update.assert_any_call(db, "ep1", status="transcribing")
        mock_update.assert_any_call(db, "ep1", inference_provider_used="fireworks")
        observability_calls = [
            c for c in mock_update.call_args_list
            if "fireworks_audio_secs" in c.kwargs
        ]
        assert len(observability_calls) == 1
        obs_kwargs = observability_calls[0].kwargs
        assert obs_kwargs["fireworks_audio_secs"] == 5.0
        assert obs_kwargs["fireworks_audio_minutes"] == 0.083
        assert obs_kwargs["fireworks_stt_cost_per_minute_usd"] == 0.01
        assert obs_kwargs["fireworks_stt_cost_usd"] == 0.0008
        assert obs_kwargs["transcribe_duration_secs"] >= 0.0
        mock_update.assert_any_call(db, "ep1", language="en", status="diarizing")
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "diarize")

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_transcription_error_propagates(
        self, mock_session_cls, mock_convert, mock_update, mock_jq
    ):
        """Issue #653: FireworksTranscriptionError propagates to the worker, which
        reads its ``retryable`` and ``error_class`` attributes via ``_classify_for_retry``.
        Worker behavior for retryable + terminal cases is covered by test_worker.py."""
        ep = _make_episode()
        ep.retry_count = 0
        ep.retry_max = 3
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        err = FireworksTranscriptionError(
            "Fireworks API HTTP 503",
            error_class="TRANSIENT_NETWORK",
            retryable=True,
            status_code=503,
        )
        with (
            patch("app.services.fireworks_audio.transcribe", side_effect=err),
            patch(
                "app.tasks.transcribe.get_runtime_inference_settings",
                return_value={
                    "inference_provider": "fireworks",
                    "fireworks_api_key": "fw_test",
                    "fireworks_audio_base_url": "https://audio-turbo.api.fireworks.ai",
                    "fireworks_stt_model": "whisper-v3-large",
                    "fireworks_stt_diarize": True,
                    "fireworks_stt_cost_per_minute_usd": 0.006,
                },
            ),
            patch("app.tasks.transcribe.settings") as mock_settings,
        ):
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006

            from app.tasks.transcribe import transcribe_episode

            with pytest.raises(FireworksTranscriptionError) as excinfo:
                transcribe_episode("ep1")

        # Metadata travels intact for the worker to consume.
        assert excinfo.value.error_class == "TRANSIENT_NETWORK"
        assert excinfo.value.retryable is True
        # Diarize was never enqueued because transcribe didn't complete.
        mock_jq.enqueue.assert_not_called()

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_import_failure_propagates(
        self, mock_session_cls, mock_convert, mock_update, mock_jq
    ):
        """Issue #653: ImportError on the lazy Fireworks load propagates;
        worker classifies as terminal SYSTEM_ERROR."""
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch(
                "app.tasks.transcribe.get_runtime_inference_settings",
                return_value={
                    "inference_provider": "fireworks",
                    "fireworks_api_key": "fw_test",
                    "fireworks_audio_base_url": "https://audio-turbo.api.fireworks.ai",
                    "fireworks_stt_model": "whisper-v3-large",
                    "fireworks_stt_diarize": True,
                    "fireworks_stt_cost_per_minute_usd": 0.006,
                },
            ),
            patch("app.tasks.transcribe._load_fireworks_service", side_effect=ImportError("boom")),
            patch("app.tasks.transcribe.settings") as mock_settings,
        ):
            mock_settings.fireworks_stt_model = "whisper-v3-large"

            from app.tasks.transcribe import transcribe_episode

            with pytest.raises(ImportError, match="boom"):
                transcribe_episode("ep1")

        mock_convert.assert_not_called()
        mock_jq.enqueue.assert_not_called()

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_zero_rate_preserved_for_cost_estimate(
        self, mock_session_cls, mock_convert, mock_update, mock_jq
    ):
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
                    "fireworks_stt_cost_per_minute_usd": 0.0,
                },
            ),
            patch("app.tasks.transcribe.settings") as mock_settings,
            patch("builtins.open", MagicMock()),
            patch("app.tasks.transcribe_helpers.json"),
        ):
            # Non-zero default must not override explicit runtime 0.
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_not_called()
        observability_calls = [
            c for c in mock_update.call_args_list
            if "fireworks_stt_cost_per_minute_usd" in c.kwargs
        ]
        assert len(observability_calls) == 1
        obs_kwargs = observability_calls[0].kwargs
        assert obs_kwargs["fireworks_stt_cost_per_minute_usd"] == 0.0
        assert obs_kwargs["fireworks_stt_cost_usd"] == 0.0
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "diarize")
