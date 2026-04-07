"""Unit tests for app.services.embed — sentence embedding service."""
import sys
from unittest.mock import MagicMock, patch

import pytest

# sentence_transformers is not installed in the test env
if "sentence_transformers" not in sys.modules:
    sys.modules["sentence_transformers"] = MagicMock()

import app.services.embed as embed_mod


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

        result = embed_mod.embed_texts(["hello", "world"])

        assert len(result) == 2
        mock_model.encode.assert_called_once_with(
            ["hello", "world"], show_progress_bar=False, normalize_embeddings=True
        )

    @patch("app.services.embed._embed_texts_fireworks", return_value=[[0.1] * 384])
    def test_routes_to_fireworks_provider(self, mock_fireworks):
        result = embed_mod.embed_texts(["hello"], runtime={"embedding_provider": "fireworks"})
        assert len(result) == 1
        mock_fireworks.assert_called_once()

    def test_fireworks_provider_requires_api_key(self):
        with pytest.raises(RuntimeError, match="FIREWORKS_API_KEY is missing"):
            embed_mod.embed_texts(
                ["hello"],
                runtime={
                    "embedding_provider": "fireworks",
                    "fireworks_api_key": None,
                },
            )


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

        result = embed_mod.embed_query("search query")

        assert len(result) == 384
        mock_model.encode.assert_called_once_with(
            ["search query"], show_progress_bar=False, normalize_embeddings=True
        )
