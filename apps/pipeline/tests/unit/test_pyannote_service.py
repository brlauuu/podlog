"""Unit tests for app.services.pyannote — speaker diarization service."""
import sys
from unittest.mock import MagicMock, patch

import pytest

# Ensure pyannote.audio and torchaudio are mockable
if "pyannote" not in sys.modules:
    sys.modules["pyannote"] = MagicMock()
    sys.modules["pyannote.audio"] = MagicMock()
if "torchaudio" not in sys.modules:
    sys.modules["torchaudio"] = MagicMock()
if "torch" not in sys.modules:
    sys.modules["torch"] = MagicMock()
    sys.modules["torch.cuda"] = MagicMock()

import app.services.pyannote as pyannote_mod


class TestLoadPipeline:
    def setup_method(self):
        pyannote_mod._pipeline = None

    @patch("app.config.settings")
    def test_loads_pipeline(self, mock_settings):
        mock_settings.hf_token = "test-token"
        mock_pipeline_obj = MagicMock()

        torch_mod = sys.modules["torch"]
        torch_mod.cuda.is_available.return_value = False

        with patch.dict(sys.modules["pyannote.audio"].__dict__, {
            "Pipeline": MagicMock(from_pretrained=MagicMock(return_value=mock_pipeline_obj))
        }):
            # Force reload to pick up mocks
            from pyannote.audio import Pipeline
            Pipeline.from_pretrained = MagicMock(return_value=mock_pipeline_obj)

            pyannote_mod.load_pipeline()

        assert pyannote_mod._pipeline is mock_pipeline_obj

    def test_skips_if_already_loaded(self):
        sentinel = MagicMock()
        pyannote_mod._pipeline = sentinel

        pyannote_mod.load_pipeline()

        assert pyannote_mod._pipeline is sentinel


class TestUnloadPipeline:
    def test_clears_pipeline(self):
        pyannote_mod._pipeline = MagicMock()

        pyannote_mod.unload_pipeline()

        assert pyannote_mod._pipeline is None

    def test_handles_torch_error(self):
        pyannote_mod._pipeline = MagicMock()
        torch_mod = sys.modules["torch"]
        torch_mod.cuda.empty_cache.side_effect = RuntimeError("no cuda")

        pyannote_mod.unload_pipeline()

        assert pyannote_mod._pipeline is None
        torch_mod.cuda.empty_cache.side_effect = None  # reset


class TestDiarize:
    def setup_method(self):
        pyannote_mod._pipeline = None

    @patch("app.services.pyannote.load_pipeline")
    def test_returns_speaker_segments(self, mock_load):
        mock_turn1 = MagicMock()
        mock_turn1.start = 0.0
        mock_turn1.end = 5.0
        mock_turn2 = MagicMock()
        mock_turn2.start = 5.0
        mock_turn2.end = 10.0

        mock_annotation = MagicMock()
        mock_annotation.itertracks.return_value = [
            (mock_turn1, None, "SPEAKER_00"),
            (mock_turn2, None, "SPEAKER_01"),
        ]

        mock_result = MagicMock()
        mock_result.speaker_diarization = mock_annotation

        mock_pipeline = MagicMock()
        mock_pipeline.return_value = mock_result

        pyannote_mod._pipeline = mock_pipeline

        torchaudio = sys.modules["torchaudio"]
        torchaudio.load = MagicMock(return_value=(MagicMock(), 16000))

        result = pyannote_mod.diarize("/path/to/audio.wav")

        assert len(result) == 2
        assert result[0] == {"speaker": "SPEAKER_00", "start": 0.0, "end": 5.0}
        assert result[1] == {"speaker": "SPEAKER_01", "start": 5.0, "end": 10.0}

    @patch("app.services.pyannote.load_pipeline")
    def test_raises_on_bad_output(self, mock_load):
        # Return object without itertracks and without speaker_diarization
        mock_result = MagicMock(spec=[])

        mock_pipeline = MagicMock()
        mock_pipeline.return_value = mock_result

        pyannote_mod._pipeline = mock_pipeline

        torchaudio = sys.modules["torchaudio"]
        torchaudio.load = MagicMock(return_value=(MagicMock(), 16000))

        with pytest.raises(TypeError, match="itertracks"):
            pyannote_mod.diarize("/path/to/audio.wav")
