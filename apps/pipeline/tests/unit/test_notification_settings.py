"""Tests for notification settings service — DB-backed with env var fallback."""
import json
from unittest.mock import MagicMock, patch

import pytest

from app.models import SystemState
from app.services.notification_settings import (
    _FIELDS,
    get_notification_settings,
    get_runtime_diarization_settings,
    get_runtime_embedding_settings,
    get_runtime_inference_settings,
    mask_sensitive,
    save_notification_settings,
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

    @pytest.mark.parametrize(
        "model", ["all-MiniLM-L6-v2", "BAAI/bge-small-en-v1.5"]
    )
    def test_accepts_both_allowlisted_embedding_models(self, model):
        """#951: the allowlist must not break the #944 recovery path.

        Installs whose corpus was embedded through Fireworks have to be able
        to set BAAI/bge-small-en-v1.5 to keep their existing vectors. If the
        allowlist rejected it, the only route back would be re-embedding.
        """
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            for field in _FIELDS:
                setattr(mock_settings, field, None)
            mock_settings.smtp_port = 25
            mock_settings.notification_frequency = "immediate"
            result = save_notification_settings(db, {"embedding_model": model})
        assert result["embedding_model"] == model

    def test_rejects_arbitrary_embedding_model(self):
        """#951: embedding_model is a remote code execution path if unvalidated.

        The value is passed straight to SentenceTransformer(), which resolves
        it as a HuggingFace Hub repo id and downloads it. transformers
        PYSEC-2026-2289 -- which cannot be fixed while whisperx pins
        huggingface-hub<1.0 -- executes attacker code from a crafted
        config.json during exactly that load. So this allowlist is the
        mitigation for an advisory we cannot patch.
        """
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="embedding_model"):
            save_notification_settings(db, {"embedding_model": "attacker/malicious-repo"})

    def test_rejects_embedding_model_that_merely_looks_plausible(self):
        # A near-miss on a real model name must fail too -- the check is an
        # allowlist, not a heuristic.
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="embedding_model"):
            save_notification_settings(db, {"embedding_model": "BAAI/bge-small-en-v1.6"})

    def test_rejects_invalid_pyannote_model(self):
        """#681: only the curated set of HF model IDs is allowed."""
        db = _mock_db(stored_json=None)
        with pytest.raises(ValueError, match="pyannote_model"):
            save_notification_settings(db, {"pyannote_model": "pyannote/random-thing"})

    def test_accepts_valid_pyannote_model(self):
        """#681: switching to the legacy 3.1 model is accepted."""
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
            mock_settings.health_check_notifications_enabled = True
            mock_settings.embedding_model = ""
            mock_settings.pyannote_model = "pyannote/speaker-diarization-community-1"
            mock_settings.rag_local_model = "qwen2.5:3b"

            result = save_notification_settings(
                db, {"pyannote_model": "pyannote/speaker-diarization-3.1"}
            )

        assert result["pyannote_model"] == "pyannote/speaker-diarization-3.1"

    def test_rag_local_model_persisted_and_returned(self):
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
            mock_settings.rag_local_model = "qwen2.5:3b"

            result = save_notification_settings(db, {"rag_local_model": "phi3:mini"})

        assert result["rag_local_model"] == "phi3:mini"

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

class TestRuntimeSettings:
    """#1092: each runtime getter returns only its local setting."""

    def test_inference_settings_hold_only_the_ask_model(self):
        db = _mock_db(stored_json=json.dumps({
            "rag_local_model": "gemma4:e4b",
            "inference_provider": "fireworks",
            "fireworks_api_key": "fw_abc",
        }))
        assert get_runtime_inference_settings(db) == {"rag_local_model": "gemma4:e4b"}

    def test_embedding_settings_hold_only_the_model(self):
        db = _mock_db(stored_json=json.dumps({
            "embedding_model": "BAAI/bge-small-en-v1.5",
            "embedding_provider": "fireworks",
        }))
        assert get_runtime_embedding_settings(db) == {"embedding_model": "BAAI/bge-small-en-v1.5"}

    def test_diarization_settings_hold_only_the_local_model(self):
        db = _mock_db(stored_json=json.dumps({
            "pyannote_model": "pyannote/speaker-diarization-3.1",
            "diarization_provider": "precision2",
            "pyannote_api_key": "pn_abc",
        }))
        assert get_runtime_diarization_settings(db) == {
            "pyannote_model": "pyannote/speaker-diarization-3.1"
        }

    def test_env_defaults_without_db(self):
        with patch("app.services.notification_settings.settings") as mock_settings:
            mock_settings.embedding_model = "all-MiniLM-L6-v2"
            assert get_runtime_embedding_settings(None) == {"embedding_model": "all-MiniLM-L6-v2"}


class TestNoRemoteFields:
    """#1092: settings carry no remote-inference keys in either direction."""

    def test_get_has_no_remote_keys(self):
        result = get_notification_settings(_mock_db(stored_json=None))

        for key in ("inference_provider", "rag_provider", "fireworks_api_key",
                    "pyannote_api_key", "fireworks_configured",
                    "pyannote_cloud_configured"):
            assert key not in result

    def test_stored_remote_values_never_leak_through(self):
        # A blob from before the upgrade still holds them until the startup
        # cleanup runs; GET must not report a remote provider or a key.
        stored = json.dumps({
            "inference_provider": "fireworks",
            "fireworks_api_key": "fw_secret_value",
        })
        result = get_notification_settings(_mock_db(stored_json=stored))

        assert "inference_provider" not in result
        assert "fireworks_api_key" not in result

    def test_save_ignores_remote_fields(self):
        db = _mock_db(stored_json=None)

        save_notification_settings(
            db,
            {"fireworks_api_key": "fw_x", "inference_provider": "fireworks", "smtp_host": "mail"},
        )

        written = json.loads(db.add.call_args[0][0].value)
        assert written == {"smtp_host": "mail"}


class TestTelegramAllowedUserIds:
    """#1034: the bot allowlist is validated on save, canonicalised, and nullable."""

    def _save(self, value):
        db = _mock_db(stored_json=None)
        with patch("app.services.notification_settings.settings") as mock_settings:
            for field in _FIELDS:
                setattr(mock_settings, field, None)
            result = save_notification_settings(db, {"telegram_allowed_user_ids": value})
        added = db.add.call_args[0][0]
        return result, json.loads(added.value)

    def test_canonicalises_whitespace_and_duplicates(self):
        result, stored = self._save(" 12,34 , 12 ,")
        assert stored["telegram_allowed_user_ids"] == "12, 34"
        assert result["telegram_allowed_user_ids"] == "12, 34"

    def test_empty_string_becomes_none(self):
        _, stored = self._save("   ")
        assert stored["telegram_allowed_user_ids"] is None

    @pytest.mark.parametrize("bad", ["@alice", "12, alice", "-5", "12.5", "+4915123"])
    def test_rejects_non_numeric_entries(self, bad):
        with pytest.raises(ValueError, match="numeric Telegram user ids"):
            self._save(bad)

    def test_rejects_non_string(self):
        with pytest.raises(ValueError, match="comma-separated string"):
            self._save([12, 34])

    def test_field_is_part_of_the_allowlist_and_nullable(self):
        from app.services.notification_settings import _NULLABLE_FIELDS

        assert "telegram_allowed_user_ids" in _FIELDS
        assert "telegram_allowed_user_ids" in _NULLABLE_FIELDS
