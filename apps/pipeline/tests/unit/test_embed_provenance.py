"""Unit tests for app.services.embed_provenance (#945)."""
import json
from unittest.mock import MagicMock, patch

import pytest

from app.services import embed_provenance as prov


def fake_db(recorded=None, raw=None):
    db = MagicMock()
    row = None
    if raw is not None:
        row = MagicMock()
        row.value = raw
    elif recorded is not None:
        row = MagicMock()
        row.value = json.dumps({"model": recorded, "dim": 384})
    db.query.return_value.filter.return_value.one_or_none.return_value = row
    return db


class TestEffectiveModelName:
    """Identity is the model, not the provider — that is the whole point.

    Both providers served BAAI/bge-small-en-v1.5, so a Fireworks-to-local
    switch on the same model must read as compatible (#944's recovery path),
    while an all-MiniLM/bge-small swap must not, whichever provider ran it.
    """

    def test_local_provider_uses_embedding_model(self):
        assert (
            prov.effective_model_name(
                {"embedding_provider": "local", "embedding_model": "all-MiniLM-L6-v2"}
            )
            == "all-MiniLM-L6-v2"
        )

    def test_fireworks_provider_uses_fireworks_model(self):
        assert (
            prov.effective_model_name(
                {
                    "embedding_provider": "fireworks",
                    "embedding_model": "all-MiniLM-L6-v2",
                    "fireworks_embedding_model": "BAAI/bge-small-en-v1.5",
                }
            )
            == "BAAI/bge-small-en-v1.5"
        )

    def test_same_model_across_providers_is_the_same_identity(self):
        remote = prov.effective_model_name(
            {
                "embedding_provider": "fireworks",
                "fireworks_embedding_model": "BAAI/bge-small-en-v1.5",
            }
        )
        local = prov.effective_model_name(
            {"embedding_provider": "local", "embedding_model": "BAAI/bge-small-en-v1.5"}
        )
        assert remote == local

    def test_falls_back_to_settings_when_runtime_is_empty(self):
        with patch.object(prov.settings, "embedding_provider", "local"), patch.object(
            prov.settings, "embedding_model", "from-settings"
        ):
            assert prov.effective_model_name(None) == "from-settings"


class TestReadState:
    def test_returns_none_when_unset(self):
        assert prov.read_state(fake_db()) is None

    def test_parses_recorded_state(self):
        state = prov.read_state(fake_db("all-MiniLM-L6-v2"))
        assert state["model"] == "all-MiniLM-L6-v2"
        assert state["dim"] == 384

    def test_corrupt_json_is_treated_as_unset_not_fatal(self):
        # A bad record must not wedge embedding forever.
        assert prov.read_state(fake_db(raw="{not json")) is None

    def test_non_dict_json_is_treated_as_unset(self):
        assert prov.read_state(fake_db(raw='"just a string"')) is None


class TestAssertMatches:
    def test_adopts_configured_model_when_nothing_recorded(self):
        db = fake_db()
        prov.assert_matches(db, 384, {"embedding_provider": "local", "embedding_model": "m1"})

        db.execute.assert_called_once()
        db.commit.assert_called_once()

    def test_passes_silently_when_the_model_matches(self):
        db = fake_db("all-MiniLM-L6-v2")
        prov.assert_matches(
            db, 384, {"embedding_provider": "local", "embedding_model": "all-MiniLM-L6-v2"}
        )
        # Nothing re-recorded on a match.
        db.execute.assert_not_called()

    def test_raises_on_a_same_dimension_different_model_swap(self):
        # The case _validate_vectors_dim cannot see: both are 384-dim.
        db = fake_db("BAAI/bge-small-en-v1.5")
        with pytest.raises(prov.EmbeddingModelMismatch) as exc:
            prov.assert_matches(
                db, 384, {"embedding_provider": "local", "embedding_model": "all-MiniLM-L6-v2"}
            )

        msg = str(exc.value)
        assert "BAAI/bge-small-en-v1.5" in msg
        assert "all-MiniLM-L6-v2" in msg
        assert "re-embed" in msg
        assert "#945" in msg
        db.execute.assert_not_called()

    def test_provider_switch_on_the_same_model_is_allowed(self):
        # #944's recovery: fireworks -> local, same underlying model. Must not
        # be blocked, or nobody can recover without re-embedding.
        db = fake_db("BAAI/bge-small-en-v1.5")
        prov.assert_matches(
            db,
            384,
            {"embedding_provider": "local", "embedding_model": "BAAI/bge-small-en-v1.5"},
        )
        db.execute.assert_not_called()

    def test_adopts_when_the_recorded_model_is_blank(self):
        db = fake_db(raw=json.dumps({"model": "", "dim": 384}))
        prov.assert_matches(db, 384, {"embedding_provider": "local", "embedding_model": "m"})
        db.execute.assert_called_once()


class TestRecordModel:
    def test_writes_model_dim_and_timestamp(self):
        db = MagicMock()
        state = prov.record_model(db, "some-model", 384)

        assert state["model"] == "some-model"
        assert state["dim"] == 384
        assert state["recorded_at"]
        db.commit.assert_called_once()
