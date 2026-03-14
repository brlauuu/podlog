"""Unit tests for the WhisperX-based whisper service."""
import gc
from unittest.mock import MagicMock, patch

import pytest


class TestLoadModel:
    def setup_method(self):
        import app.services.whisper as ws
        ws._model = None

    def test_load_model_creates_whisperx_model(self):
        """load_model() creates a WhisperX model with correct args."""
        mock_model = MagicMock()
        with patch("app.services.whisper._cuda_available", return_value=False), \
             patch("whisperx.load_model", return_value=mock_model) as mock_load:
            import app.services.whisper as ws
            ws.load_model("large-v3-turbo")
            mock_load.assert_called_once_with(
                "large-v3-turbo", device="cpu", compute_type="int8",
            )
            assert ws._model is mock_model

    def test_load_model_noop_if_cached(self):
        """load_model() is a no-op when model is already loaded."""
        with patch("whisperx.load_model") as mock_load:
            import app.services.whisper as ws
            ws._model = MagicMock()  # already loaded
            ws.load_model("large-v3-turbo")
            mock_load.assert_not_called()


class TestUnloadModel:
    def test_unload_clears_model(self):
        """unload_model() sets _model to None and calls gc.collect()."""
        import app.services.whisper as ws
        ws._model = MagicMock()
        ws.unload_model()
        assert ws._model is None


class TestTranscribe:
    MOCK_SEGMENTS = [
        {"start": 0.0, "end": 2.5, "text": " Hello world. "},
        {"start": 2.5, "end": 5.0, "text": " Second segment. "},
    ]

    def test_transcribe_returns_expected_format(self):
        """transcribe() returns (segments, language) with correct structure."""
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {
            "segments": self.MOCK_SEGMENTS,
            "language": "en",
        }

        mock_align_model = MagicMock()
        mock_metadata = MagicMock()
        aligned_result = {
            "segments": [
                {"start": 0.0, "end": 2.5, "text": " Hello world. "},
                {"start": 2.5, "end": 5.0, "text": " Second segment. "},
            ],
        }

        import app.services.whisper as ws
        ws._model = mock_model
        with patch("app.services.whisper.load_model"), \
             patch("app.services.whisper._cuda_available", return_value=False), \
             patch("whisperx.load_audio", return_value=MagicMock()), \
             patch("whisperx.load_align_model", return_value=(mock_align_model, mock_metadata)), \
             patch("whisperx.align", return_value=aligned_result):
            segments, language, result = ws.transcribe("/tmp/test.wav")

        assert language == "en"
        assert len(segments) == 2
        assert segments[0] == {"start": 0.0, "end": 2.5, "text": "Hello world."}
        assert segments[1] == {"start": 2.5, "end": 5.0, "text": "Second segment."}
        assert "segments" in result

    def test_transcribe_handles_unknown_language(self):
        """transcribe() returns 'unknown' when language detection fails."""
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {
            "segments": [],
            "language": None,
        }

        import app.services.whisper as ws
        ws._model = mock_model
        with patch("app.services.whisper.load_model"), \
             patch("app.services.whisper._cuda_available", return_value=False), \
             patch("whisperx.load_audio", return_value=MagicMock()), \
             patch("whisperx.load_align_model", side_effect=Exception("no model for unknown")):
            segments, language, result = ws.transcribe("/tmp/test.wav")

        assert language == "unknown"
        assert segments == []

    def test_transcribe_graceful_alignment_failure(self):
        """transcribe() falls back to segment-level timestamps when alignment fails."""
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {
            "segments": self.MOCK_SEGMENTS,
            "language": "en",
        }

        import app.services.whisper as ws
        ws._model = mock_model
        with patch("app.services.whisper.load_model"), \
             patch("app.services.whisper._cuda_available", return_value=False), \
             patch("whisperx.load_audio", return_value=MagicMock()), \
             patch("whisperx.load_align_model", side_effect=Exception("alignment failed")):
            segments, language, result = ws.transcribe("/tmp/test.wav")

        assert language == "en"
        assert len(segments) == 2
        assert segments[0] == {"start": 0.0, "end": 2.5, "text": "Hello world."}

    def test_transcribe_passes_batch_size_from_settings(self):
        """transcribe() passes whisper_batch_size from settings to model.transcribe()."""
        mock_model = MagicMock()
        mock_model.transcribe.return_value = {
            "segments": [],
            "language": "en",
        }

        import app.services.whisper as ws
        ws._model = mock_model
        with patch("app.services.whisper.load_model"), \
             patch("app.services.whisper._cuda_available", return_value=False), \
             patch("whisperx.load_audio", return_value=MagicMock()) as mock_load_audio, \
             patch("whisperx.load_align_model", side_effect=Exception("skip")), \
             patch("app.config.settings") as mock_settings:
            mock_settings.whisper_batch_size = 8
            ws.transcribe("/tmp/test.wav")

        mock_model.transcribe.assert_called_once()
        call_kwargs = mock_model.transcribe.call_args
        assert call_kwargs[1]["batch_size"] == 8
