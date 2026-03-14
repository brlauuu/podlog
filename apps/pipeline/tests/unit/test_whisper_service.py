"""Unit tests for the faster-whisper based whisper service."""
from unittest.mock import MagicMock, patch

import pytest


class TestLoadModel:
    def setup_method(self):
        import app.services.whisper as ws
        ws._model = None

    def test_load_model_creates_whisper_model(self):
        """load_model() creates a WhisperModel with correct args."""
        with patch("app.services.whisper._cuda_available", return_value=False), \
             patch("faster_whisper.WhisperModel") as MockModel:
            import app.services.whisper as ws
            ws.load_model("large-v3-turbo")
            MockModel.assert_called_once_with("large-v3-turbo", device="cpu", compute_type="int8")
            assert ws._model is not None

    def test_load_model_noop_if_cached(self):
        """load_model() is a no-op when model is already loaded."""
        with patch("faster_whisper.WhisperModel") as MockModel:
            import app.services.whisper as ws
            ws._model = MagicMock()  # already loaded
            ws.load_model("large-v3-turbo")
            MockModel.assert_not_called()


class TestUnloadModel:
    def test_unload_clears_model(self):
        """unload_model() sets _model to None and calls gc.collect()."""
        import app.services.whisper as ws
        ws._model = MagicMock()
        ws.unload_model()
        assert ws._model is None


class TestTranscribe:
    MOCK_SEGMENTS = [
        MagicMock(start=0.0, end=2.5, text=" Hello world. "),
        MagicMock(start=2.5, end=5.0, text=" Second segment. "),
    ]

    def test_transcribe_returns_expected_format(self):
        """transcribe() returns (segments, language) with correct structure."""
        mock_info = MagicMock()
        mock_info.language = "en"

        mock_model = MagicMock()
        mock_model.transcribe.return_value = (iter(self.MOCK_SEGMENTS), mock_info)

        import app.services.whisper as ws
        ws._model = mock_model
        with patch("app.services.whisper.load_model"):
            segments, language = ws.transcribe("/tmp/test.wav")

        assert language == "en"
        assert len(segments) == 2
        assert segments[0] == {"start": 0.0, "end": 2.5, "text": "Hello world."}
        assert segments[1] == {"start": 2.5, "end": 5.0, "text": "Second segment."}

    def test_transcribe_handles_unknown_language(self):
        """transcribe() returns 'unknown' when language detection fails."""
        mock_info = MagicMock()
        mock_info.language = None

        mock_model = MagicMock()
        mock_model.transcribe.return_value = (iter([]), mock_info)

        import app.services.whisper as ws
        ws._model = mock_model
        with patch("app.services.whisper.load_model"):
            segments, language = ws.transcribe("/tmp/test.wav")

        assert language == "unknown"
        assert segments == []
