"""
Sentence embedding service for semantic search (Level 3).

Uses all-MiniLM-L6-v2 (80MB, 384 dimensions) for fast CPU inference.
Unlike Whisper/pyannote, this model is small enough to stay loaded.
"""
import logging
from typing import Any

import httpx
import numpy as np

from app.config import settings

logger = logging.getLogger(__name__)

_model = None
_model_name = None
EMBEDDING_DIM = 384


def _load_model(model_name: str):
    global _model, _model_name
    if _model is None or _model_name != model_name:
        from sentence_transformers import SentenceTransformer

        logger.info('"action": "embed_model_load_start", "model": "%s"', model_name)
        _model = SentenceTransformer(model_name)
        _model_name = model_name
        logger.info('"action": "embed_model_load_complete", "model": "%s"', model_name)
    return _model


def _runtime_value(runtime: dict[str, Any] | None, key: str, default: Any) -> Any:
    if runtime is not None and key in runtime and runtime.get(key) is not None:
        return runtime.get(key)
    return default


def _normalize(vec: list[float]) -> list[float]:
    arr = np.asarray(vec, dtype=np.float32)
    norm = float(np.linalg.norm(arr))
    if norm <= 0:
        return arr.tolist()
    return (arr / norm).tolist()


def _validate_vectors_dim(vectors: list[list[float]], expected_count: int) -> None:
    if len(vectors) != expected_count:
        raise RuntimeError(
            f"Embeddings response size mismatch: expected {expected_count}, got {len(vectors)}"
        )

    for idx, vector in enumerate(vectors):
        if len(vector) != EMBEDDING_DIM:
            raise RuntimeError(
                f"Unexpected embedding dimension {len(vector)} (expected {EMBEDDING_DIM}) at index {idx}. "
                "Switch model/provider or backfill embeddings."
            )


def _embed_texts_fireworks(texts: list[str], runtime: dict[str, Any] | None = None) -> list[list[float]]:
    api_key = _runtime_value(runtime, "fireworks_api_key", settings.fireworks_api_key)
    if not api_key:
        raise RuntimeError(
            "Fireworks embedding provider selected but FIREWORKS_API_KEY is missing"
        )

    base_url = _runtime_value(
        runtime, "fireworks_embedding_base_url", settings.fireworks_embedding_base_url
    )
    model = _runtime_value(runtime, "fireworks_embedding_model", settings.fireworks_embedding_model)
    url = base_url.rstrip("/") + "/embeddings"

    timeout = httpx.Timeout(connect=20.0, read=120.0, write=20.0, pool=20.0)
    headers = {"Authorization": f"Bearer {api_key}"}
    payload = {"model": model, "input": texts}

    with httpx.Client(timeout=timeout) as client:
        resp = client.post(url, headers=headers, json=payload)
        resp.raise_for_status()
        data = resp.json()

    items = data.get("data", []) or []
    vectors: list[list[float]] = []
    for item in items:
        emb = item.get("embedding")
        if not isinstance(emb, list):
            raise RuntimeError("Fireworks embeddings response missing embedding vector")
        vectors.append(_normalize([float(x) for x in emb]))
    _validate_vectors_dim(vectors, len(texts))

    logger.info(
        '"action": "fireworks_embed_complete", "count": %d, "model": "%s"',
        len(vectors),
        model,
    )
    return vectors


def embed_texts(texts: list[str], runtime: dict[str, Any] | None = None) -> list[list[float]]:
    """Embed a batch of texts. Returns list of 384-dim float vectors."""
    if not texts:
        return []

    provider = _runtime_value(runtime, "embedding_provider", settings.embedding_provider)
    if provider == "fireworks":
        return _embed_texts_fireworks(texts, runtime)

    model_name = _runtime_value(runtime, "embedding_model", settings.embedding_model)
    model = _load_model(model_name)
    embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    vectors = embeddings.tolist()
    _validate_vectors_dim(vectors, len(texts))
    return vectors


def embed_query(text: str, runtime: dict[str, Any] | None = None) -> list[float]:
    """Embed a single search query. Returns a 384-dim float vector."""
    vectors = embed_texts([text], runtime=runtime)
    return vectors[0]
