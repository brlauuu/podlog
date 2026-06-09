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
        pyannote_mod._pipeline_model = None

    @patch("app.services.pyannote._resolve_model")
    @patch("app.config.settings")
    def test_loads_pipeline(self, mock_settings, mock_resolve):
        mock_settings.hf_token = "test-token"
        mock_resolve.return_value = "pyannote/speaker-diarization-community-1"
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
        assert pyannote_mod._pipeline_model == "pyannote/speaker-diarization-community-1"

    @patch("app.services.pyannote._resolve_model")
    def test_skips_if_already_loaded_with_same_model(self, mock_resolve):
        mock_resolve.return_value = "pyannote/speaker-diarization-community-1"
        sentinel = MagicMock()
        pyannote_mod._pipeline = sentinel
        pyannote_mod._pipeline_model = "pyannote/speaker-diarization-community-1"

        pyannote_mod.load_pipeline()

        assert pyannote_mod._pipeline is sentinel

    @patch("app.services.pyannote._resolve_model")
    @patch("app.config.settings")
    def test_uses_configured_model_id(self, mock_settings, mock_resolve):
        """Regression guard: the HF model id is read from runtime resolution
        (settings.pyannote_model env default or DB override), not hardcoded —
        see issue #515 and #681."""
        mock_settings.hf_token = "test-token"
        mock_resolve.return_value = "pyannote/speaker-diarization-community-1"

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

    @patch("app.services.pyannote._resolve_model")
    @patch("app.config.settings")
    def test_reloads_when_model_changes(self, mock_settings, mock_resolve):
        """Issue #681: switching the model in Settings unloads the old
        pipeline and loads the new one on the next call."""
        mock_settings.hf_token = "test-token"

        torch_mod = sys.modules["torch"]
        torch_mod.cuda.is_available.return_value = False

        first_obj = MagicMock(name="community-1")
        second_obj = MagicMock(name="3.1")
        from_pretrained_mock = MagicMock(side_effect=[first_obj, second_obj])
        sys.modules["pyannote.audio"].Pipeline = MagicMock(
            from_pretrained=from_pretrained_mock
        )

        # First call → loads community-1
        mock_resolve.return_value = "pyannote/speaker-diarization-community-1"
        pyannote_mod.load_pipeline()
        assert pyannote_mod._pipeline is first_obj
        assert pyannote_mod._pipeline_model == "pyannote/speaker-diarization-community-1"

        # User switches model in Settings → second call reloads with 3.1
        mock_resolve.return_value = "pyannote/speaker-diarization-3.1"
        pyannote_mod.load_pipeline()
        assert pyannote_mod._pipeline is second_obj
        assert pyannote_mod._pipeline_model == "pyannote/speaker-diarization-3.1"

        assert from_pretrained_mock.call_count == 2
        assert from_pretrained_mock.call_args_list[0][0][0] == "pyannote/speaker-diarization-community-1"
        assert from_pretrained_mock.call_args_list[1][0][0] == "pyannote/speaker-diarization-3.1"


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
        pyannote_mod._pipeline_model = None
        _install_hfhub_errors_mock()

    @patch("app.services.pyannote._resolve_model", return_value="pyannote/speaker-diarization-community-1")
    @patch("app.config.settings")
    def test_gated_repo_error_is_reraised_with_actionable_message(self, mock_settings, _mock_resolve):
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

    @patch("app.services.pyannote._resolve_model", return_value="pyannote/typo")
    @patch("app.config.settings")
    def test_repository_not_found_is_reraised_with_actionable_message(self, mock_settings, _mock_resolve):
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

    @patch("app.services.pyannote._resolve_model", return_value="pyannote/speaker-diarization-community-1")
    @patch("app.config.settings")
    def test_http_401_is_reraised_with_actionable_message(self, mock_settings, _mock_resolve):
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

    @patch("app.services.pyannote._resolve_model", return_value="pyannote/speaker-diarization-community-1")
    @patch("app.config.settings")
    def test_non_auth_exception_is_not_rewrapped(self, mock_settings, _mock_resolve):
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
        pyannote_mod._pipeline_model = "pyannote/speaker-diarization-community-1"

        pyannote_mod.unload_pipeline()

        assert pyannote_mod._pipeline is None
        assert pyannote_mod._pipeline_model is None

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


class TestResolveModel:
    """Cover the runtime-vs-env model resolution path (#822).

    Patches `settings.pyannote_model` as an attribute (not the whole
    `settings` object) so `app.database`'s import-time `create_engine`
    isn't fed a MagicMock for `database_url`.
    """

    def _patch_env(self, value):
        from app.config import settings
        return patch.object(settings, "pyannote_model", value)

    def test_returns_runtime_override_when_present(self):
        # Pre-import app.database before patching so the real engine is
        # already constructed.
        import app.database  # noqa: F401
        with (
            self._patch_env("env-default-model"),
            patch("app.database.SessionLocal") as mock_sl,
            patch(
                "app.services.notification_settings.get_runtime_diarization_settings",
                return_value={"pyannote_model": "runtime-override-model"},
            ),
        ):
            mock_sl.return_value.__enter__.return_value = MagicMock()
            mock_sl.return_value.__exit__.return_value = False
            assert pyannote_mod._resolve_model() == "runtime-override-model"

    def test_falls_back_to_env_when_no_override(self):
        import app.database  # noqa: F401
        with (
            self._patch_env("env-default-model"),
            patch("app.database.SessionLocal") as mock_sl,
            patch(
                "app.services.notification_settings.get_runtime_diarization_settings",
                return_value={},
            ),
        ):
            mock_sl.return_value.__enter__.return_value = MagicMock()
            mock_sl.return_value.__exit__.return_value = False
            assert pyannote_mod._resolve_model() == "env-default-model"

    def test_falls_back_to_env_when_override_is_whitespace(self):
        import app.database  # noqa: F401
        with (
            self._patch_env("env-default-model"),
            patch("app.database.SessionLocal") as mock_sl,
            patch(
                "app.services.notification_settings.get_runtime_diarization_settings",
                return_value={"pyannote_model": "   "},
            ),
        ):
            mock_sl.return_value.__enter__.return_value = MagicMock()
            mock_sl.return_value.__exit__.return_value = False
            assert pyannote_mod._resolve_model() == "env-default-model"

    def test_falls_back_to_env_when_override_is_not_str(self):
        import app.database  # noqa: F401
        with (
            self._patch_env("env-default-model"),
            patch("app.database.SessionLocal") as mock_sl,
            patch(
                "app.services.notification_settings.get_runtime_diarization_settings",
                return_value={"pyannote_model": 42},
            ),
        ):
            mock_sl.return_value.__enter__.return_value = MagicMock()
            mock_sl.return_value.__exit__.return_value = False
            assert pyannote_mod._resolve_model() == "env-default-model"

    def test_falls_back_to_env_when_db_raises(self):
        import app.database  # noqa: F401
        with (
            self._patch_env("env-default-model"),
            patch("app.database.SessionLocal", side_effect=Exception("db down")),
        ):
            assert pyannote_mod._resolve_model() == "env-default-model"


class TestEnsureWav:
    """Cover the non-WAV conversion branch (#822)."""

    def test_wav_input_returns_unchanged(self, tmp_path):
        wav = tmp_path / "audio.wav"
        wav.write_bytes(b"")
        path, is_temp = pyannote_mod._ensure_wav(str(wav))
        assert path == str(wav)
        assert is_temp is False

    def test_mp3_input_runs_ffmpeg_and_marks_temp(self, tmp_path):
        mp3 = tmp_path / "audio.mp3"
        mp3.write_bytes(b"")
        with patch("subprocess.run") as mock_run:
            path, is_temp = pyannote_mod._ensure_wav(str(mp3))
        assert path.endswith(".diarize.wav")
        assert is_temp is True
        # ffmpeg was invoked with the expected mono-16kHz arguments.
        called_args = mock_run.call_args[0][0]
        assert called_args[0] == "ffmpeg"
        assert "-ar" in called_args
        assert called_args[called_args.index("-ar") + 1] == "16000"
        assert "-ac" in called_args
        assert called_args[called_args.index("-ac") + 1] == "1"
