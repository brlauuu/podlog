"""Tests for notification settings service — DB-backed with env var fallback."""
import json
from unittest.mock import MagicMock, patch

import pytest

from app.models import SystemState
from app.services.notification_settings import (
    get_notification_settings,
    get_runtime_inference_settings,
    save_notification_settings,
    mask_sensitive,
    SETTINGS_KEY,
)


def _mock_db(stored_json: str | None = None):
    """Create a mock DB session. If stored_json is provided, simulate an existing row."""
    db = MagicMock()
    if stored_json is not None:
        row = MagicMock(spec=SystemState)
        row.key = SETTINGS_KEY
        row.value = stored_json
        db.query.return_value.filter.return_value.first.return_value = row
    else:
        db.query.return_value.filter.return_value.first.return_value = None
    return db


class TestGetNotificationSettings:
    def test_returns_env_var_defaults_when_no_db_row(self):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = get_notification_settings(db)

        assert result["telegram_bot_token"] is None
        assert result["notification_email_from"] == "podlog@localhost"
        assert result["smtp_port"] == 25
        assert result["notification_frequency"] == "immediate"
        assert result["telegram_configured"] is False
        assert result["email_configured"] is False

    def test_returns_db_values_when_row_exists(self):
        stored = json.dumps({
            "telegram_bot_token": "123:ABC",
            "telegram_chat_id": "999",
            "notification_email_to": "user@example.com",
        })
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = get_notification_settings(db)

        assert result["telegram_bot_token"] == "123:ABC"
        assert result["telegram_chat_id"] == "999"
        assert result["notification_email_to"] == "user@example.com"
        assert result["notification_email_from"] == "podlog@localhost"
        assert result["telegram_configured"] is True
        assert result["email_configured"] is True

    def test_db_values_override_env_vars(self):
        stored = json.dumps({"smtp_port": 587, "smtp_use_tls": True})
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = get_notification_settings(db)

        assert result["smtp_port"] == 587
        assert result["smtp_use_tls"] is True


class TestSaveNotificationSettings:
    def test_creates_row_when_none_exists(self):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(db, {"telegram_bot_token": "tok123"})

        assert result["telegram_bot_token"] == "tok123"
        db.add.assert_called_once()
        db.commit.assert_called_once()

    def test_merges_into_existing_row(self):
        stored = json.dumps({"telegram_bot_token": "old_token", "telegram_chat_id": "999"})
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(db, {"telegram_bot_token": "new_token"})

        assert result["telegram_bot_token"] == "new_token"
        assert result["telegram_chat_id"] == "999"
        db.commit.assert_called_once()

    def test_rejects_invalid_frequency(self):
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="notification_frequency"):
            save_notification_settings(db, {"notification_frequency": "hourly"})

    def test_rejects_invalid_smtp_port(self):
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="smtp_port"):
            save_notification_settings(db, {"smtp_port": -1})

    def test_rejects_invalid_inference_provider(self):
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="inference_provider"):
            save_notification_settings(db, {"inference_provider": "cloud"})

    def test_empty_string_normalized_to_none(self):
        stored = json.dumps({"notification_email_to": "user@example.com"})
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(db, {"notification_email_to": ""})

        assert result["notification_email_to"] is None
        assert result["email_configured"] is False

    def test_whitespace_only_normalized_to_none(self):
        stored = json.dumps({"notification_email_to": "user@example.com"})
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(db, {"notification_email_to": "   "})

        assert result["notification_email_to"] is None
        assert result["email_configured"] is False

    def test_rejects_invalid_email_format(self):
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="notification_email_to"):
            save_notification_settings(db, {"notification_email_to": "not-an-email"})

    def test_accepts_comma_separated_emails(self):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(
                db, {"notification_email_to": "a@example.com, b@example.com"}
            )

        assert result["notification_email_to"] == "a@example.com, b@example.com"
        assert result["email_configured"] is True

    def test_rejects_comma_list_with_invalid_email(self):
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="notification_email_to"):
            save_notification_settings(
                db, {"notification_email_to": "good@example.com, bad-email"}
            )

    def test_trailing_comma_is_handled(self):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(
                db, {"notification_email_to": "a@example.com,"}
            )

        assert result["notification_email_to"] == "a@example.com"
        assert result["email_configured"] is True

    def test_email_whitespace_normalized(self):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.telegram_bot_token = None
            mock_settings.telegram_chat_id = None
            mock_settings.notification_email_to = None
            mock_settings.notification_email_from = "podlog@localhost"
            mock_settings.smtp_host = "host.docker.internal"
            mock_settings.smtp_port = 25
            mock_settings.smtp_user = None
            mock_settings.smtp_password = None
            mock_settings.smtp_use_tls = False
            mock_settings.notification_frequency = "immediate"

            result = save_notification_settings(
                db, {"notification_email_to": "a@example.com,   b@example.com"}
            )

        assert result["notification_email_to"] == "a@example.com, b@example.com"


class TestMaskSensitive:
    def test_masks_bot_token(self):
        s = {"telegram_bot_token": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"}
        result = mask_sensitive(s)
        assert result["telegram_bot_token"] != "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
        assert result["telegram_bot_token"].startswith("123")
        assert result["telegram_bot_token"].endswith("w11")
        assert "***" in result["telegram_bot_token"]

    def test_masks_smtp_password(self):
        s = {"smtp_password": "my-secret-password"}
        result = mask_sensitive(s)
        assert "***" in result["smtp_password"]

    def test_leaves_none_values_as_none(self):
        s = {"telegram_bot_token": None, "smtp_password": None}
        result = mask_sensitive(s)
        assert result["telegram_bot_token"] is None
        assert result["smtp_password"] is None

    def test_masks_fireworks_api_key(self):
        s = {"fireworks_api_key": "fw_test_1234567890"}
        result = mask_sensitive(s)
        assert result["fireworks_api_key"] != "fw_test_1234567890"
        assert "***" in result["fireworks_api_key"]


class TestRuntimeInferenceSettings:
    def test_uses_db_override_when_present(self):
        stored = json.dumps({"inference_provider": "fireworks", "fireworks_api_key": "fw_abc"})
        db = _mock_db(stored_json=stored)
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.inference_provider = "local"
            mock_settings.fireworks_api_key = None
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_stt_diarize = True
            result = get_runtime_inference_settings(db)
        assert result["inference_provider"] == "fireworks"
        assert result["fireworks_api_key"] == "fw_abc"

    def test_uses_env_defaults_without_db(self):
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.inference_provider = "local"
            mock_settings.fireworks_api_key = None
            mock_settings.fireworks_audio_base_url = "https://audio-turbo.api.fireworks.ai"
            mock_settings.fireworks_stt_model = "whisper-v3-large"
            mock_settings.fireworks_stt_diarize = True
            result = get_runtime_inference_settings(None)
        assert result["inference_provider"] == "local"
