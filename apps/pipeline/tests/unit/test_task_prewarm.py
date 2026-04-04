"""Unit tests for app.tasks.prewarm — model pre-warming task."""
from unittest.mock import MagicMock, patch

import pytest


class TestIsPrewarmDone:
    @patch("app.database.SessionLocal")
    def test_returns_true_when_flag_set(self, mock_session_cls):
        row = MagicMock()
        row.value = "1"
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = row
        mock_session_cls.return_value = db

        from app.tasks.prewarm import _is_prewarm_done

        assert _is_prewarm_done() is True

    @patch("app.database.SessionLocal")
    def test_returns_false_when_no_row(self, mock_session_cls):
        db = MagicMock()
        db.query.return_value.filter.return_value.first.return_value = None
        mock_session_cls.return_value = db

        from app.tasks.prewarm import _is_prewarm_done

        assert _is_prewarm_done() is False

    def test_returns_false_on_exception(self):
        with patch("app.database.SessionLocal", side_effect=RuntimeError("db down")):
            from app.tasks.prewarm import _is_prewarm_done

            assert _is_prewarm_done() is False


class TestMain:
    @patch("app.tasks.prewarm._set_prewarm_done")
    @patch("app.tasks.prewarm._is_prewarm_done", return_value=True)
    @patch("app.config.settings")
    def test_skips_when_already_done(self, mock_settings, mock_check, mock_set):
        mock_settings.model_cache_dir = "/tmp/models"

        with patch("pathlib.Path.exists", return_value=True):
            from app.tasks.prewarm import main

            main()

        mock_set.assert_not_called()

    @patch("app.tasks.prewarm._set_prewarm_done")
    @patch("app.tasks.prewarm._is_prewarm_done", return_value=False)
    @patch("app.config.settings")
    def test_loads_and_unloads_models(self, mock_settings, mock_check, mock_set):
        mock_settings.model_cache_dir = "/tmp/models"
        mock_settings.whisper_model = "large-v3-turbo"

        with (
            patch("pathlib.Path.exists", return_value=False),
            patch("app.services.whisper.load_model"),
            patch("app.services.whisper.unload_model"),
            patch("app.services.pyannote.load_pipeline"),
            patch("app.services.pyannote.unload_pipeline"),
        ):
            from app.tasks.prewarm import main

            main()

        mock_set.assert_called_once()

    @patch("app.tasks.prewarm._is_prewarm_done", return_value=False)
    @patch("app.config.settings")
    def test_whisper_failure_exits(self, mock_settings, mock_check):
        mock_settings.model_cache_dir = "/tmp/models"
        mock_settings.whisper_model = "large-v3-turbo"

        with (
            patch("pathlib.Path.exists", return_value=False),
            patch("app.services.whisper.load_model", side_effect=RuntimeError("model failed")),
            pytest.raises(SystemExit),
        ):
            from app.tasks.prewarm import main

            main()

    @patch("app.tasks.prewarm._set_prewarm_done")
    @patch("app.tasks.prewarm._is_prewarm_done", return_value=False)
    @patch("app.config.settings")
    def test_pyannote_failure_is_non_fatal(self, mock_settings, mock_check, mock_set):
        mock_settings.model_cache_dir = "/tmp/models"
        mock_settings.whisper_model = "large-v3-turbo"

        with (
            patch("pathlib.Path.exists", return_value=False),
            patch("app.services.whisper.load_model"),
            patch("app.services.whisper.unload_model"),
            patch("app.services.pyannote.load_pipeline", side_effect=RuntimeError("pyannote fail")),
            patch("app.services.pyannote.unload_pipeline"),
        ):
            from app.tasks.prewarm import main

            main()

        mock_set.assert_called_once()
