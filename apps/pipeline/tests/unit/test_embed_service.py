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

    def test_fails_when_local_embedding_dim_mismatches_schema(self):
        mock_model = MagicMock()
        mock_embeddings = MagicMock()
        mock_embeddings.tolist.return_value = [[0.1] * 768]
        mock_model.encode.return_value = mock_embeddings

        embed_mod._model = mock_model
        embed_mod._model_name = "all-MiniLM-L6-v2"

        with pytest.raises(RuntimeError, match=r"Unexpected embedding dimension 768 \(expected 384\)"):
            embed_mod.embed_texts(["hello"])


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


class TestNormalize:
    """Cover _normalize (#822)."""

    def test_unit_vector_passes_through(self):
        # Unit vector — norm = 1 — should round-trip.
        result = embed_mod._normalize([1.0, 0.0, 0.0])
        assert pytest.approx(result, abs=1e-6) == [1.0, 0.0, 0.0]

    def test_scales_to_unit_norm(self):
        result = embed_mod._normalize([3.0, 4.0])  # norm = 5
        import math
        assert math.isclose(result[0], 0.6, abs_tol=1e-6)
        assert math.isclose(result[1], 0.8, abs_tol=1e-6)

    def test_zero_vector_returns_unchanged(self):
        # Division-by-zero guard: zero vector returns itself.
        assert embed_mod._normalize([0.0, 0.0, 0.0]) == [0.0, 0.0, 0.0]


class TestValidateVectorsDim:
    """Cover _validate_vectors_dim count mismatch (#822)."""

    def test_count_mismatch_raises(self):
        with pytest.raises(RuntimeError, match="size mismatch"):
            embed_mod._validate_vectors_dim([[0.0] * 384], expected_count=2)


class TestEmbedTextsFireworks:
    """Cover the Fireworks embedding provider (#822)."""

    def _ok_response(self, vectors):
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(
            return_value={"data": [{"embedding": v} for v in vectors]}
        )
        return resp

    def _client_cm(self, post_return):
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        client_cm.post = MagicMock(return_value=post_return)
        return client_cm

    def test_raises_when_api_key_missing(self):
        with patch.object(embed_mod.settings, "fireworks_api_key", None):
            with pytest.raises(RuntimeError, match="FIREWORKS_API_KEY is missing"):
                embed_mod._embed_texts_fireworks(["hello"])

    def test_happy_path_returns_normalized_vectors(self):
        # Use 3-4 raw vector, gets normalized to length 384 in the test
        # via the validation step? No — validation hard-coded to 384.
        # Build full 384-dim vectors to clear validation.
        v1 = [0.1] * 384
        v2 = [0.2] * 384
        resp = self._ok_response([v1, v2])
        client_cm = self._client_cm(resp)
        with (
            patch.object(embed_mod.settings, "fireworks_api_key", "fk_test"),
            patch.object(embed_mod.settings, "fireworks_embedding_base_url",
                          "https://embed-prod.fireworks.ai/v1"),
            patch.object(embed_mod.settings, "fireworks_embedding_model",
                          "accounts/fireworks/models/embedding"),
            patch.object(embed_mod.httpx, "Client", return_value=client_cm),
        ):
            result = embed_mod._embed_texts_fireworks(["a", "b"])
        assert len(result) == 2
        # Vectors normalized to unit length
        import math
        for vec in result:
            assert math.isclose(sum(x * x for x in vec) ** 0.5, 1.0, abs_tol=1e-5)
        # Endpoint URL strips trailing slash and appends /embeddings
        called_url = client_cm.post.call_args[0][0]
        assert called_url == "https://embed-prod.fireworks.ai/v1/embeddings"

    def test_uses_runtime_override_when_provided(self):
        v1 = [0.1] * 384
        resp = self._ok_response([v1])
        client_cm = self._client_cm(resp)
        with (
            patch.object(embed_mod.settings, "fireworks_api_key", "env-key"),
            patch.object(embed_mod.settings, "fireworks_embedding_base_url", "https://env/v1"),
            patch.object(embed_mod.settings, "fireworks_embedding_model", "env-model"),
            patch.object(embed_mod.httpx, "Client", return_value=client_cm),
        ):
            embed_mod._embed_texts_fireworks(
                ["hello"],
                runtime={
                    "fireworks_api_key": "runtime-key",
                    "fireworks_embedding_base_url": "https://runtime/v1",
                    "fireworks_embedding_model": "runtime-model",
                },
            )
        called_args, called_kwargs = client_cm.post.call_args
        assert called_args[0] == "https://runtime/v1/embeddings"
        assert called_kwargs["headers"]["Authorization"] == "Bearer runtime-key"
        assert called_kwargs["json"]["model"] == "runtime-model"

    def test_raises_when_embedding_is_not_list(self):
        # Malformed response — embedding is a string instead of a list.
        resp = MagicMock()
        resp.raise_for_status = MagicMock()
        resp.json = MagicMock(
            return_value={"data": [{"embedding": "not-a-list"}]}
        )
        client_cm = self._client_cm(resp)
        with (
            patch.object(embed_mod.settings, "fireworks_api_key", "fk_test"),
            patch.object(embed_mod.settings, "fireworks_embedding_base_url", "https://x/v1"),
            patch.object(embed_mod.settings, "fireworks_embedding_model", "m"),
            patch.object(embed_mod.httpx, "Client", return_value=client_cm),
        ):
            with pytest.raises(RuntimeError, match="missing embedding vector"):
                embed_mod._embed_texts_fireworks(["a"])

    def test_batches_requests_over_256_inputs(self):
        # Two batches: 256 + 1
        v = [0.0] * 384
        v[0] = 1.0  # non-zero so normalize doesn't div-by-zero
        # First call returns 256 items, second returns 1
        resp1 = self._ok_response([v] * 256)
        resp2 = self._ok_response([v])
        client_cm = MagicMock()
        client_cm.__enter__ = MagicMock(return_value=client_cm)
        client_cm.__exit__ = MagicMock(return_value=False)
        client_cm.post = MagicMock(side_effect=[resp1, resp2])
        with (
            patch.object(embed_mod.settings, "fireworks_api_key", "fk_test"),
            patch.object(embed_mod.settings, "fireworks_embedding_base_url", "https://x/v1"),
            patch.object(embed_mod.settings, "fireworks_embedding_model", "m"),
            patch.object(embed_mod.httpx, "Client", return_value=client_cm),
        ):
            result = embed_mod._embed_texts_fireworks(["t"] * 257)
        assert len(result) == 257
        assert client_cm.post.call_count == 2
