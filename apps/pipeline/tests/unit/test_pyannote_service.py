"""Unit tests for app.services.pyannote — speaker diarization service."""
import sys
from unittest.mock import MagicMock, patch

import pytest

# Ensure pyannote.audio, torchaudio, torch, and soundfile are mockable
if "pyannote" not in sys.modules:
    sys.modules["pyannote"] = MagicMock()
    sys.modules["pyannote.audio"] = MagicMock()
if "torchaudio" not in sys.modules:
    sys.modules["torchaudio"] = MagicMock()
if "torch" not in sys.modules:
    sys.modules["torch"] = MagicMock()
    sys.modules["torch.cuda"] = MagicMock()
# diarize() imports soundfile at call time; always use a mock so the tests
# don't touch the real libsndfile on environments where it's installed.
_soundfile_mock = MagicMock()
sys.modules["soundfile"] = _soundfile_mock

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

    @patch("app.config.settings")
    def test_uses_configured_model_id(self, mock_settings):
        """Regression guard: the HF model id is read from settings.pyannote_model,
        not hardcoded — see issue #515."""
        mock_settings.hf_token = "test-token"
        mock_settings.pyannote_model = "pyannote/speaker-diarization-community-1"

        torch_mod = sys.modules["torch"]
        torch_mod.cuda.is_available.return_value = False

        from_pretrained_mock = MagicMock(return_value=MagicMock())
        pyannote_audio = sys.modules["pyannote.audio"]
        pyannote_audio.Pipeline = MagicMock(from_pretrained=from_pretrained_mock)

        pyannote_mod.load_pipeline()

        from_pretrained_mock.assert_called_once()
        args, kwargs = from_pretrained_mock.call_args
        assert args[0] == "pyannote/speaker-diarization-community-1"
        assert kwargs.get("token") == "test-token"


class _FakeHfHubAuthErrors:
    """Stand-ins for huggingface_hub.errors so the helper can import them."""

    class GatedRepoError(Exception):
        pass

    class RepositoryNotFoundError(Exception):
        pass

    class HfHubHTTPError(Exception):
        def __init__(self, message="", response=None):
            super().__init__(message)
            self.response = response


def _install_hfhub_errors_mock():
    mod = MagicMock()
    mod.GatedRepoError = _FakeHfHubAuthErrors.GatedRepoError
    mod.RepositoryNotFoundError = _FakeHfHubAuthErrors.RepositoryNotFoundError
    mod.HfHubHTTPError = _FakeHfHubAuthErrors.HfHubHTTPError
    sys.modules["huggingface_hub"] = MagicMock()
    sys.modules["huggingface_hub.errors"] = mod


class TestLoadPipelineAuthErrors:
    def setup_method(self):
        pyannote_mod._pipeline = None
        _install_hfhub_errors_mock()

    @patch("app.config.settings")
    def test_gated_repo_error_is_reraised_with_actionable_message(self, mock_settings):
        mock_settings.hf_token = "test-token"
        mock_settings.pyannote_model = "pyannote/speaker-diarization-community-1"

        torch_mod = sys.modules["torch"]
        torch_mod.cuda.is_available.return_value = False

        from_pretrained_mock = MagicMock(
            side_effect=_FakeHfHubAuthErrors.GatedRepoError("gated")
        )
        sys.modules["pyannote.audio"].Pipeline = MagicMock(
            from_pretrained=from_pretrained_mock
        )

        with pytest.raises(RuntimeError) as exc_info:
            pyannote_mod.load_pipeline()

        msg = str(exc_info.value)
        assert "pyannote_auth_failed" in msg
        assert "pyannote/speaker-diarization-community-1" in msg
        assert "HF_TOKEN" in msg
        assert "repo id" in msg
        assert "gate accepted" in msg
        assert "https://huggingface.co/pyannote/speaker-diarization-community-1" in msg

    @patch("app.config.settings")
    def test_repository_not_found_is_reraised_with_actionable_message(self, mock_settings):
        mock_settings.hf_token = "test-token"
        mock_settings.pyannote_model = "pyannote/typo"

        torch_mod = sys.modules["torch"]
        torch_mod.cuda.is_available.return_value = False

        from_pretrained_mock = MagicMock(
            side_effect=_FakeHfHubAuthErrors.RepositoryNotFoundError("not found")
        )
        sys.modules["pyannote.audio"].Pipeline = MagicMock(
            from_pretrained=from_pretrained_mock
        )

        with pytest.raises(RuntimeError) as exc_info:
            pyannote_mod.load_pipeline()

        assert "pyannote/typo" in str(exc_info.value)

    @patch("app.config.settings")
    def test_http_401_is_reraised_with_actionable_message(self, mock_settings):
        mock_settings.hf_token = "test-token"
        mock_settings.pyannote_model = "pyannote/speaker-diarization-community-1"

        torch_mod = sys.modules["torch"]
        torch_mod.cuda.is_available.return_value = False

        fake_response = MagicMock()
        fake_response.status_code = 401
        err = _FakeHfHubAuthErrors.HfHubHTTPError("401 Client Error", response=fake_response)

        from_pretrained_mock = MagicMock(side_effect=err)
        sys.modules["pyannote.audio"].Pipeline = MagicMock(
            from_pretrained=from_pretrained_mock
        )

        with pytest.raises(RuntimeError) as exc_info:
            pyannote_mod.load_pipeline()

        assert "pyannote_auth_failed" in str(exc_info.value)

    @patch("app.config.settings")
    def test_non_auth_exception_is_not_rewrapped(self, mock_settings):
        """Unrelated errors (e.g. OSError from disk) must bubble up untouched."""
        mock_settings.hf_token = "test-token"
        mock_settings.pyannote_model = "pyannote/speaker-diarization-community-1"

        torch_mod = sys.modules["torch"]
        torch_mod.cuda.is_available.return_value = False

        from_pretrained_mock = MagicMock(side_effect=OSError("disk full"))
        sys.modules["pyannote.audio"].Pipeline = MagicMock(
            from_pretrained=from_pretrained_mock
        )

        with pytest.raises(OSError, match="disk full"):
            pyannote_mod.load_pipeline()


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

        sf = sys.modules["soundfile"]
        sf.read = MagicMock(return_value=(MagicMock(), 16000))

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

        sf = sys.modules["soundfile"]
        sf.read = MagicMock(return_value=(MagicMock(), 16000))

        with pytest.raises(TypeError, match="itertracks"):
            pyannote_mod.diarize("/path/to/audio.wav")
