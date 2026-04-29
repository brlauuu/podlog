"""Unit tests for app.tasks.diarize — diarization task."""
import json
from unittest.mock import MagicMock, patch, mock_open

import pytest


def _make_episode(id_="ep1", audio_path="/data/audio/raw/ep1.mp3"):
    ep = MagicMock()
    ep.id = id_
    ep.audio_local_path = audio_path
    return ep


def _make_segment(id_=1, start=0.0, end=5.0, text="hello", speaker=None):
    seg = MagicMock()
    seg.id = id_
    seg.start_time = start
    seg.end_time = end
    seg.text = text
    seg.speaker_label = speaker
    return seg


class TestDiarizeEpisode:
    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_happy_path_wordlevel(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        db.query.return_value.filter.return_value.delete.return_value = 0
        mock_session_cls.return_value = db

        diar_segs = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 10.0}]
        rebuilt = [{"start": 0.0, "end": 5.0, "text": "hello", "speaker": "SPEAKER_00"}]
        aligned_data = {"segments": [{"words": [{"word": "hello", "start": 0.0, "end": 0.5}]}]}

        with (
            patch("app.services.pyannote.diarize", return_value=diar_segs),
            patch("app.services.pyannote.unload_pipeline"),
            patch("app.tasks.diarize.settings") as mock_settings,
            patch("app.services.alignment.assign_speakers_wordlevel", return_value=rebuilt),
            patch("pathlib.Path.exists", return_value=True),
            patch("pathlib.Path.unlink"),
            patch("builtins.open", mock_open(read_data=json.dumps(aligned_data))),
        ):
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        matching = [
            call for call in mock_update.call_args_list
            if call.args[:2] == (db, "ep1")
            and call.kwargs.get("has_diarization") is True
            and call.kwargs.get("diarization_error") is None
            and "diarize_duration_secs" in call.kwargs
            and "diarize_step_durations" in call.kwargs
        ]
        assert matching
        assert "provider_diarization_secs" in matching[0].kwargs["diarize_step_durations"]
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")

    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_segment_level_fallback_when_no_alignment(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        segs = [_make_segment()]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        diar_segs = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 10.0}]
        assignments = {1: "SPEAKER_00"}

        with (
            patch("app.services.pyannote.diarize", return_value=diar_segs),
            patch("app.services.pyannote.unload_pipeline"),
            patch("app.tasks.diarize.settings") as mock_settings,
            patch("app.services.alignment.assign_speakers", return_value=assignments),
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        matching = [
            call for call in mock_update.call_args_list
            if call.args[:2] == (db, "ep1")
            and call.kwargs.get("has_diarization") is True
            and call.kwargs.get("diarization_error") is None
            and "diarize_step_durations" in call.kwargs
        ]
        assert matching
        assert "speaker_assignment_secs" in matching[0].kwargs["diarize_step_durations"]
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")

    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_diarize_failure_is_non_fatal(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch("app.services.pyannote.diarize", side_effect=RuntimeError("pyannote crash")),
            patch("app.services.pyannote.unload_pipeline"),
            patch("app.tasks.diarize.settings") as mock_settings,
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        # Should mark diarization as failed but continue
        matching = [
            call for call in mock_update.call_args_list
            if call.args[:2] == (db, "ep1")
            and call.kwargs.get("has_diarization") is False
            and call.kwargs.get("diarization_error") == "pyannote crash"
        ]
        assert matching
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")

    @patch("app.tasks.diarize.SessionLocal")
    def test_missing_episode_raises(self, mock_session_cls):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.diarize.settings") as mock_settings,
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.diarize import diarize_episode

            with pytest.raises(RuntimeError, match="missing"):
                diarize_episode("ep1")

    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_fireworks_provider_uses_saved_artifact(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        segs = [_make_segment()]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        fireworks_raw = {
            "segments": [
                {"start": 0.0, "end": 2.0},
            ],
            "words": [
                {"speaker_id": "0", "word": "Hello", "start": 0.0, "end": 1.0},
                {"speaker_id": "0", "word": "world.", "start": 1.0, "end": 2.0},
            ],
        }

        with (
            patch("app.tasks.diarize.settings") as mock_settings,
            patch(
                "app.tasks.diarize.get_runtime_inference_settings",
                return_value={
                    "inference_provider": "fireworks",
                    "fireworks_stt_diarize": True,
                },
            ),
            patch("pathlib.Path.exists", return_value=True),
            patch("pathlib.Path.unlink"),
            patch("builtins.open", mock_open(read_data=json.dumps(fireworks_raw))),
            patch("app.services.alignment.assign_speakers", return_value={1: "SPEAKER_00"}),
        ):
            mock_settings.transcript_dir = "/data/transcripts"

            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        matching = [
            call for call in mock_update.call_args_list
            if call.args[:2] == (db, "ep1")
            and call.kwargs.get("has_diarization") is True
            and call.kwargs.get("diarization_error") is None
            and "diarize_duration_secs" in call.kwargs
            and "diarize_step_durations" in call.kwargs
        ]
        assert matching
        assert "segment_rebuild_secs" in matching[0].kwargs["diarize_step_durations"]
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")

    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_precision2_dispatches_to_cloud_service(
        self, mock_session_cls, mock_update, mock_jq
    ):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        segs = [_make_segment()]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        diar_segs = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 30.0}]

        with (
            patch("app.tasks.diarize.settings") as mock_settings,
            patch(
                "app.tasks.diarize.get_runtime_inference_settings",
                return_value={"inference_provider": "local"},
            ),
            patch(
                "app.tasks.diarize.get_runtime_diarization_settings",
                return_value={
                    "diarization_provider": "precision2",
                    "pyannote_api_key": "pn_test",
                    "pyannote_cloud_base_url": "https://api.pyannote.ai/v1",
                    "pyannote_cloud_model": "precision-2",
                    "pyannote_cloud_cost_per_second_usd": 0.001,
                },
            ),
            patch(
                "app.services.pyannote_cloud.diarize_via_cloud",
                return_value=(diar_segs, 30.0, 0.03),
            ),
            patch("app.services.alignment.assign_speakers", return_value={1: "SPEAKER_00"}),
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.transcript_dir = "/data/transcripts"
            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        matching = [
            call for call in mock_update.call_args_list
            if call.args[:2] == (db, "ep1")
            and call.kwargs.get("has_diarization") is True
            and call.kwargs.get("pyannote_cloud_cost_usd") == pytest.approx(0.03)
        ]
        assert matching, "Expected an update with pyannote_cloud_cost_usd written"
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")

    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_precision2_failure_is_non_fatal(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.diarize.settings") as mock_settings,
            patch(
                "app.tasks.diarize.get_runtime_inference_settings",
                return_value={"inference_provider": "local"},
            ),
            patch(
                "app.tasks.diarize.get_runtime_diarization_settings",
                return_value={
                    "diarization_provider": "precision2",
                    "pyannote_api_key": "pn_test",
                    "pyannote_cloud_base_url": "https://api.pyannote.ai/v1",
                    "pyannote_cloud_model": "precision-2",
                    "pyannote_cloud_cost_per_second_usd": 0.001,
                },
            ),
            patch(
                "app.services.pyannote_cloud.diarize_via_cloud",
                side_effect=RuntimeError("cloud crash"),
            ),
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.transcript_dir = "/data/transcripts"
            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        matching = [
            call for call in mock_update.call_args_list
            if call.args[:2] == (db, "ep1")
            and call.kwargs.get("has_diarization") is False
            and call.kwargs.get("diarization_error") == "cloud crash"
        ]
        assert matching, "Expected graceful-failure update with cloud_crash error"
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")

    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_fireworks_diarize_disabled_is_noop(self, mock_session_cls, mock_update, mock_jq):
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        mock_session_cls.return_value = db

        with (
            patch("app.tasks.diarize.settings") as mock_settings,
            patch(
                "app.tasks.diarize.get_runtime_inference_settings",
                return_value={
                    "inference_provider": "fireworks",
                    "fireworks_stt_diarize": False,
                },
            ),
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.transcript_dir = "/data/transcripts"
            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        mock_update.assert_any_call(
            db, "ep1", has_diarization=False, diarization_error=None, diarize_step_durations=None
        )
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")

    @patch("app.tasks.diarize.job_queue")
    @patch("app.tasks.diarize.update_episode")
    @patch("app.tasks.diarize.SessionLocal")
    def test_chunked_fireworks_routes_to_diarization_provider(
        self, mock_session_cls, mock_update, mock_jq
    ):
        """Issue #610: chunked Fireworks transcription bypasses the
        Fireworks-word-level diarize path and uses diarization_provider
        (here: precision2) on the whole file."""
        ep = _make_episode()
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = ep
        segs = [_make_segment()]
        db.query.return_value.filter.return_value.order_by.return_value.all.return_value = segs
        mock_session_cls.return_value = db

        diar_segs = [{"speaker": "SPEAKER_00", "start": 0.0, "end": 30.0}]

        with (
            patch("app.tasks.diarize.settings") as mock_settings,
            patch(
                "app.tasks.diarize.get_runtime_inference_settings",
                return_value={
                    "inference_provider": "fireworks",
                    "fireworks_stt_diarize": True,
                    "fireworks_chunked_transcription_enabled": True,
                },
            ),
            patch(
                "app.tasks.diarize.get_runtime_diarization_settings",
                return_value={
                    "diarization_provider": "precision2",
                    "pyannote_api_key": "pa_test",
                    "pyannote_cloud_base_url": "https://api.pyannote.ai/v1",
                    "pyannote_cloud_model": "precision-2",
                    "pyannote_cloud_cost_per_second_usd": 0.0,
                },
            ),
            patch(
                "app.services.pyannote_cloud.diarize_via_cloud",
                return_value=(diar_segs, 30.0, 0.0),
            ) as mock_cloud,
            patch("app.services.alignment.assign_speakers", return_value={1: "SPEAKER_00"}),
            patch("pathlib.Path.exists", return_value=False),
        ):
            mock_settings.transcript_dir = "/data/transcripts"
            from app.tasks.diarize import diarize_episode

            result = diarize_episode("ep1")

        assert result == "ep1"
        # Cloud diarization was invoked on the whole file — confirms the
        # Fireworks-word-level branch was bypassed.
        mock_cloud.assert_called_once()
        matching = [
            call for call in mock_update.call_args_list
            if call.args[:2] == (db, "ep1")
            and call.kwargs.get("has_diarization") is True
            and call.kwargs.get("pyannote_cloud_cost_usd") == 0.0
        ]
        assert matching, "Expected a precision2 success update with pyannote_cloud_cost_usd"
        mock_jq.enqueue.assert_called_once_with(db, "ep1", "chunk")
