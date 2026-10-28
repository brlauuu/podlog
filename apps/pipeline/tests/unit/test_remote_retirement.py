"""Tests for switching an upgraded install off remote inference (#1092)."""
import json
from unittest.mock import MagicMock, patch

import pytest

from app.models import SystemState
from app.services import remote_retirement
from app.services.notification_settings import SETTINGS_KEY, save_notification_settings


def _mock_db(stored: dict | None = None):
    """A session whose notification_settings row holds ``stored`` (None: no row)."""
    db = MagicMock()
    if stored is not None:
        row = MagicMock(spec=SystemState)
        row.key = SETTINGS_KEY
        row.value = json.dumps(stored)
        db.query.return_value.filter.return_value.first.return_value = row
    else:
        db.query.return_value.filter.return_value.first.return_value = None
    return db


def _stored_after(db) -> dict:
    """What the row holds after the call (or the new row that was added)."""
    if db.add.called:
        return json.loads(db.add.call_args[0][0].value)
    return json.loads(db.query.return_value.filter.return_value.first.return_value.value)


def _fields_set(fields: set[str]):
    """Pretend exactly ``fields`` came from env or .env.

    Pydantic adds a field to model_fields_set whenever it is assigned, and
    patch.object assigns -- so other test modules leave it polluted.
    """
    return patch.object(
        type(remote_retirement.settings),
        "model_fields_set",
        new_callable=lambda: property(lambda self: fields),
    )


@pytest.fixture(autouse=True)
def _nothing_from_env():
    with _fields_set(set()):
        yield


@pytest.fixture(autouse=True)
def _no_provenance():
    with patch.object(remote_retirement.embed_provenance, "read_state", return_value=None) as m:
        yield m


class TestRetireRemoteSettings:
    @pytest.mark.parametrize(
        "field,remote",
        [
            ("inference_provider", "fireworks"),
            ("diarization_provider", "precision2"),
            ("rag_provider", "fireworks"),
            ("embedding_provider", "fireworks"),
        ],
    )
    def test_stored_remote_provider_becomes_local(self, field, remote):
        db = _mock_db({field: remote})

        changed = remote_retirement.retire_remote_settings(db)

        assert field in changed
        assert _stored_after(db)[field] == "local"
        db.commit.assert_called_once()

    def test_logs_one_warning_per_coerced_provider(self):
        db = _mock_db({"inference_provider": "fireworks", "rag_provider": "fireworks"})

        with patch.object(remote_retirement.logger, "warning") as warn:
            remote_retirement.retire_remote_settings(db)

        provider_warnings = [
            c for c in warn.call_args_list if "remote_provider_retired" in c[0][0]
        ]
        assert sorted(c[0][1] for c in provider_warnings) == [
            "inference_provider",
            "rag_provider",
        ]

    def test_remote_provider_from_env_is_overridden_in_storage(self):
        # A leftover INFERENCE_PROVIDER=fireworks in .env must not win: the
        # stored value overrides env, so "local" has to be written, not just
        # the stored key removed.
        db = _mock_db(None)

        with patch.object(remote_retirement.settings, "inference_provider", "fireworks"):
            changed = remote_retirement.retire_remote_settings(db)

        assert changed == ["inference_provider"]
        assert _stored_after(db) == {"inference_provider": "local"}

    def test_deletes_stored_keys_and_remote_only_fields(self):
        db = _mock_db(
            {
                "fireworks_api_key": "fw_secret_value",
                "pyannote_api_key": "pn_secret_value",
                "fireworks_chat_model": "accounts/fireworks/models/gpt-oss-120b",
                "fireworks_stt_model": "whisper-v3-turbo",
                "telegram_chat_id": "123",
            }
        )

        remote_retirement.retire_remote_settings(db)

        assert _stored_after(db) == {"telegram_chat_id": "123"}

    def test_never_logs_a_deleted_key_value(self):
        db = _mock_db({"fireworks_api_key": "fw_secret_value"})

        with patch.object(remote_retirement.logger, "warning") as warn:
            remote_retirement.retire_remote_settings(db)

        logged = " ".join(str(a) for c in warn.call_args_list for a in c[0])
        assert "fireworks_api_key" in logged
        assert "fw_secret_value" not in logged

    def test_leaves_local_settings_untouched(self):
        db = _mock_db({"inference_provider": "local", "embedding_model": "all-MiniLM-L6-v2"})

        assert remote_retirement.retire_remote_settings(db) == []
        db.commit.assert_not_called()

    def test_second_run_changes_nothing(self):
        db = _mock_db({"inference_provider": "fireworks", "fireworks_api_key": "fw_x"})

        remote_retirement.retire_remote_settings(db)
        assert remote_retirement.retire_remote_settings(db) == []
        db.commit.assert_called_once()


class TestEmbeddingModelPin:
    def test_pins_the_recorded_model_when_none_was_chosen(self, _no_provenance):
        # The Fireworks path embedded with bge-small; the local default is
        # all-MiniLM. Without the pin, the provenance guard fails every embed.
        _no_provenance.return_value = {"model": "BAAI/bge-small-en-v1.5", "dim": 384}
        db = _mock_db({"embedding_provider": "fireworks"})

        changed = remote_retirement.retire_remote_settings(db)

        assert "embedding_model" in changed
        assert _stored_after(db)["embedding_model"] == "BAAI/bge-small-en-v1.5"

    def test_respects_a_model_chosen_in_settings(self, _no_provenance):
        _no_provenance.return_value = {"model": "BAAI/bge-small-en-v1.5", "dim": 384}
        db = _mock_db({"embedding_model": "all-MiniLM-L6-v2"})

        assert remote_retirement.retire_remote_settings(db) == []

    def test_respects_a_model_chosen_in_env(self, _no_provenance):
        _no_provenance.return_value = {"model": "BAAI/bge-small-en-v1.5", "dim": 384}
        db = _mock_db({})

        with _fields_set({"embedding_model"}):
            assert remote_retirement.retire_remote_settings(db) == []

    def test_ignores_a_recorded_model_outside_the_allowlist(self, _no_provenance):
        # The value goes to SentenceTransformer(), which downloads whatever
        # repo it names (#951); a provenance record is no reason to trust it.
        _no_provenance.return_value = {"model": "someone/else", "dim": 384}
        db = _mock_db({})

        assert remote_retirement.retire_remote_settings(db) == []

    def test_no_pin_when_recorded_model_is_the_default(self, _no_provenance):
        _no_provenance.return_value = {"model": "all-MiniLM-L6-v2", "dim": 384}
        db = _mock_db({})

        assert remote_retirement.retire_remote_settings(db) == []


class TestRetiredEnvVars:
    def test_names_retired_vars_that_are_set(self):
        with _fields_set({"diarization_provider", "fireworks_api_key", "hf_token"}):
            assert remote_retirement.retired_env_vars_set() == [
                "DIARIZATION_PROVIDER",
                "FIREWORKS_API_KEY",
            ]


class TestRunAtStartup:
    def test_never_blocks_startup_when_the_db_fails(self):
        factory = MagicMock(side_effect=RuntimeError("db not ready"))

        with patch.object(remote_retirement.logger, "exception") as exc:
            remote_retirement.run_at_startup(factory)

        assert "remote_retirement_failed" in exc.call_args[0][0]

    def test_closes_the_session_even_when_the_cleanup_fails(self):
        db = MagicMock()
        db.query.side_effect = RuntimeError("boom")

        remote_retirement.run_at_startup(lambda: db)

        db.close.assert_called_once()

    def test_warns_about_retired_env_vars(self):
        with patch.object(
            remote_retirement, "retired_env_vars_set", return_value=["FIREWORKS_API_KEY"]
        ), patch.object(remote_retirement, "retire_remote_settings"), patch.object(
            remote_retirement.logger, "warning"
        ) as warn:
            remote_retirement.run_at_startup(MagicMock())

        assert "retired_env_vars_set" in warn.call_args[0][0]
        assert "FIREWORKS_API_KEY" in warn.call_args[0][1]


class TestSaveRejectsRemoteProviders:
    @pytest.mark.parametrize(
        "field,value",
        [
            ("inference_provider", "fireworks"),
            ("diarization_provider", "precision2"),
            ("rag_provider", "fireworks"),
            ("embedding_provider", "fireworks"),
        ],
    )
    def test_rejects_remote_value(self, field, value):
        db = _mock_db(None)

        with pytest.raises(ValueError, match="no longer offers remote inference"):
            save_notification_settings(db, {field: value})
        db.commit.assert_not_called()

    def test_accepts_local(self):
        db = _mock_db(None)

        result = save_notification_settings(db, {"inference_provider": "local"})

        assert result["inference_provider"] == "local"
