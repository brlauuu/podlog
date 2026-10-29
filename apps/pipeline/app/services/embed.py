"""
Sentence embedding service for semantic search (Level 3).

Uses all-MiniLM-L6-v2 (80MB, 384 dimensions) for fast CPU inference.
Unlike Whisper/pyannote, this model is small enough to stay loaded.
"""
import logging
from typing import Any

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


def _validate_vectors_dim(vectors: list[list[float]], expected_count: int) -> None:
    if len(vectors) != expected_count:
        raise RuntimeError(
            f"Embeddings response size mismatch: expected {expected_count}, got {len(vectors)}"
        )

    for idx, vector in enumerate(vectors):
        if len(vector) != EMBEDDING_DIM:
            raise RuntimeError(
                f"Unexpected embedding dimension {len(vector)} (expected {EMBEDDING_DIM}) at index {idx}. "
                "Switch model or backfill embeddings."
            )


def _check_provenance(runtime: dict[str, Any] | None, db: Any = None) -> None:
    """Refuse to embed with a model other than the one that built the corpus (#945).

    The session is opened here rather than threaded through every caller. There
    are five call sites across tasks, the API and RAG, and an opt-in ``db``
    argument would make the guard something a sixth caller could forget — which
    is the whole failure mode this protects against.
    """
    from app.services.embed_provenance import assert_matches

    if db is not None:
        assert_matches(db, EMBEDDING_DIM, runtime)
        return

    from app.database import SessionLocal

    own = SessionLocal()
    try:
        assert_matches(own, EMBEDDING_DIM, runtime)
    finally:
        own.close()


def embed_texts(
    texts: list[str], runtime: dict[str, Any] | None = None, db: Any = None
) -> list[list[float]]:
    """Embed a batch of texts. Returns list of 384-dim float vectors.

    ``db`` is an optional session injection for tests; production callers let
    the provenance check open its own.
    """
    if not texts:
        return []

    _check_provenance(runtime, db)

    model_name = _runtime_value(runtime, "embedding_model", settings.embedding_model)
    model = _load_model(model_name)
    embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    vectors = embeddings.tolist()
    _validate_vectors_dim(vectors, len(texts))
    return vectors


def embed_query(text: str, runtime: dict[str, Any] | None = None, db: Any = None) -> list[float]:
    """Embed a single search query. Returns a 384-dim float vector."""
    vectors = embed_texts([text], runtime=runtime, db=db)
    return vectors[0]
