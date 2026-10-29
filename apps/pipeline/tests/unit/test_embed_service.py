"""Unit tests for app.services.embed — sentence embedding service."""
import json
import sys
from unittest.mock import MagicMock, patch

import pytest

# sentence_transformers is not installed in the test env
if "sentence_transformers" not in sys.modules:
    sys.modules["sentence_transformers"] = MagicMock()

import app.services.embed as embed_mod


def fake_db(recorded_model=None):
    """Session stub for the #945 provenance guard.

    embed_texts now checks the recorded corpus model before embedding, and
    opens its own session when none is passed. Unit tests inject this instead
    so the guard runs for real against a known record rather than being
    patched out -- an unbypassable guard that tests bypass is not a guard.
    """
    db = MagicMock()
    row = None
    if recorded_model is not None:
        row = MagicMock()
        row.value = json.dumps({"model": recorded_model, "dim": 384})
    db.query.return_value.filter.return_value.one_or_none.return_value = row
    return db



class TestLoadModel:
    def setup_method(self):
        embed_mod._model = None
        embed_mod._model_name = None

    def test_loads_model_on_first_call(self):
        mock_model = MagicMock()
        st_mod = sys.modules["sentence_transformers"]
        st_mod.SentenceTransformer = MagicMock(return_value=mock_model)

        result = embed_mod._load_model("all-MiniLM-L6-v2")

        assert result is mock_model
        assert embed_mod._model is mock_model

    def test_returns_cached_model(self):
        mock_model = MagicMock()
        embed_mod._model = mock_model
        embed_mod._model_name = "all-MiniLM-L6-v2"

        result = embed_mod._load_model("all-MiniLM-L6-v2")

        assert result is mock_model

    def test_reloads_when_model_name_changes(self):
        first_model = MagicMock()
        second_model = MagicMock()
        st_mod = sys.modules["sentence_transformers"]
        with patch.object(
            st_mod, "SentenceTransformer", MagicMock(side_effect=[first_model, second_model])
        ) as mock_ctor:
            result1 = embed_mod._load_model("all-MiniLM-L6-v2")
            result2 = embed_mod._load_model("sentence-transformers/all-mpnet-base-v2")

        assert result1 is first_model
        assert result2 is second_model
        assert mock_ctor.call_count == 2


class TestEmbedTexts:
    def setup_method(self):
        embed_mod._model = None
        embed_mod._model_name = None

    def test_returns_empty_for_empty_input(self):
        result = embed_mod.embed_texts([])
        assert result == []

    def test_embeds_batch(self):
        mock_model = MagicMock()
        mock_embeddings = MagicMock()
        mock_embeddings.tolist.return_value = [[0.1] * 384, [0.2] * 384]
        mock_model.encode.return_value = mock_embeddings

        embed_mod._model = mock_model
        embed_mod._model_name = "all-MiniLM-L6-v2"

        result = embed_mod.embed_texts(["hello", "world"], db=fake_db("all-MiniLM-L6-v2"))

        assert len(result) == 2
        mock_model.encode.assert_called_once_with(
            ["hello", "world"], show_progress_bar=False, normalize_embeddings=True
        )

    def test_fails_when_local_embedding_dim_mismatches_schema(self):
        mock_model = MagicMock()
        mock_embeddings = MagicMock()
        mock_embeddings.tolist.return_value = [[0.1] * 768]
        mock_model.encode.return_value = mock_embeddings

        embed_mod._model = mock_model
        embed_mod._model_name = "all-MiniLM-L6-v2"

        with pytest.raises(RuntimeError, match=r"Unexpected embedding dimension 768 \(expected 384\)"):
            embed_mod.embed_texts(["hello"], db=fake_db("all-MiniLM-L6-v2"))


class TestEmbedQuery:
    def setup_method(self):
        embed_mod._model = None
        embed_mod._model_name = None

    def test_embeds_single_query(self):
        mock_model = MagicMock()
        mock_embedding = MagicMock()
        mock_embedding.tolist.return_value = [[0.1] * 384]
        mock_model.encode.return_value = mock_embedding

        embed_mod._model = mock_model
        embed_mod._model_name = "all-MiniLM-L6-v2"

        result = embed_mod.embed_query("search query", db=fake_db("all-MiniLM-L6-v2"))

        assert len(result) == 384
        mock_model.encode.assert_called_once_with(
            ["search query"], show_progress_bar=False, normalize_embeddings=True
        )


class TestValidateVectorsDim:
    """Cover _validate_vectors_dim count mismatch (#822)."""

    def test_count_mismatch_raises(self):
        with pytest.raises(RuntimeError, match="size mismatch"):
            embed_mod._validate_vectors_dim([[0.0] * 384], expected_count=2)

