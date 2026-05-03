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
    @patch("app.tasks.transcribe._mark_failed")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_transient_error_schedules_retry(
        self, mock_session_cls, mock_convert, mock_update, mock_fail, mock_jq
    ):
        ep = _make_episode()
        ep.retry_count = 0
        ep.retry_max = 3
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch(
                "app.services.fireworks_audio.transcribe",
                side_effect=FireworksTranscriptionError(
                    "Fireworks API HTTP 429",
                    error_class="TRANSIENT_NETWORK",
                    retryable=True,
                    status_code=429,
                ),
            ),
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
            mock_settings.retry_backoff_base = 30
            mock_settings.retry_max = 3
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_not_called()
        mock_fail.assert_not_called()
        # status="transcribing" then retry state update
        assert mock_update.call_count >= 2
        mock_jq.enqueue.assert_called_once()
        _, enqueue_kwargs = mock_jq.enqueue.call_args
        assert enqueue_kwargs["retry_at"] is not None

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe._mark_failed")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_transient_error_marks_failed_after_max_retries(
        self, mock_session_cls, mock_convert, mock_update, mock_fail, mock_jq
    ):
        ep = _make_episode()
        ep.retry_count = 3
        ep.retry_max = 3
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch(
                "app.services.fireworks_audio.transcribe",
                side_effect=FireworksTranscriptionError(
                    "Fireworks API HTTP 503",
                    error_class="TRANSIENT_NETWORK",
                    retryable=True,
                    status_code=503,
                ),
            ),
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
            mock_settings.retry_backoff_base = 30
            mock_settings.retry_max = 3
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_not_called()
        mock_jq.enqueue.assert_not_called()
        mock_fail.assert_called_once()
        assert mock_fail.call_args[0][2] == "TRANSIENT_NETWORK"

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe._mark_failed")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_upload_rejected_retries_with_backoff(
        self, mock_session_cls, mock_convert, mock_update, mock_fail, mock_jq
    ):
        """Issue #641: FIREWORKS_UPLOAD_REJECTED is now retryable (transient TLS abort).

        The original immediate-fail behavior (issue #600) was based on a wrong
        assumption that this signaled a hard size/duration cap. Bulk-reprocessing
        showed it's transient with ~99% recovery on retry.
        """
        ep = _make_episode()
        ep.retry_count = 0
        ep.retry_max = 3
        ep.duration_secs = 8388  # 2h 19m, the original incident
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch(
                "app.services.fireworks_audio.transcribe",
                side_effect=FireworksTranscriptionError(
                    "Fireworks rejected the upload mid-stream (TLS abort) on a 192 MB file. "
                    "Will retry up to retry_max attempts. Underlying error: BAD_RECORD_MAC",
                    error_class="FIREWORKS_UPLOAD_REJECTED",
                    retryable=True,
                ),
            ),
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
            mock_settings.retry_backoff_base = 30
            mock_settings.retry_max = 3
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_not_called()
        # Issue #641: retry is now enqueued with backoff, not failed immediately.
        mock_fail.assert_not_called()
        mock_jq.enqueue.assert_called_once()
        _, enqueue_kwargs = mock_jq.enqueue.call_args
        assert enqueue_kwargs["retry_at"] is not None

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe._mark_failed")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_upload_rejected_marks_failed_after_max_retries(
        self, mock_session_cls, mock_convert, mock_update, mock_fail, mock_jq
    ):
        """Once retry_max is exhausted, FIREWORKS_UPLOAD_REJECTED becomes terminal."""
        ep = _make_episode()
        ep.retry_count = 3
        ep.retry_max = 3
        ep.duration_secs = 8388
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch(
                "app.services.fireworks_audio.transcribe",
                side_effect=FireworksTranscriptionError(
                    "Fireworks rejected the upload mid-stream (TLS abort) on a 192 MB file. "
                    "Will retry up to retry_max attempts. Underlying error: BAD_RECORD_MAC",
                    error_class="FIREWORKS_UPLOAD_REJECTED",
                    retryable=True,
                ),
            ),
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
            mock_settings.retry_backoff_base = 30
            mock_settings.retry_max = 3
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_jq.enqueue.assert_not_called()
        mock_fail.assert_called_once()
        assert mock_fail.call_args[0][2] == "FIREWORKS_UPLOAD_REJECTED"

    @patch("app.tasks.transcribe.job_queue")
    @patch("app.tasks.transcribe._mark_failed")
    @patch("app.tasks.transcribe.update_episode")
    @patch("app.tasks.transcribe._convert_to_wav")
    @patch("app.tasks.transcribe.SessionLocal")
    def test_fireworks_import_failure_marks_system_error(
        self, mock_session_cls, mock_convert, mock_update, mock_fail, mock_jq
    ):
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
            mock_settings.retry_backoff_base = 30
            mock_settings.retry_max = 3
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_cost_per_minute_usd = 0.006

            from app.tasks.transcribe import transcribe_episode

            result = transcribe_episode("ep1")

        assert result == "ep1"
        mock_convert.assert_not_called()
        mock_jq.enqueue.assert_not_called()
        mock_fail.assert_called_once()
        assert mock_fail.call_args[0][2] == "SYSTEM_ERROR"

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
