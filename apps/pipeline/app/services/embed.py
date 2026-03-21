"""
Sentence embedding service for semantic search (Level 3).

Uses all-MiniLM-L6-v2 (80MB, 384 dimensions) for fast CPU inference.
Unlike Whisper/pyannote, this model is small enough to stay loaded.
"""
import logging

logger = logging.getLogger(__name__)

_model = None
MODEL_NAME = "all-MiniLM-L6-v2"
EMBEDDING_DIM = 384


def _load_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer

        logger.info('"action": "embed_model_load_start", "model": "%s"', MODEL_NAME)
        _model = SentenceTransformer(MODEL_NAME)
        logger.info('"action": "embed_model_load_complete", "model": "%s"', MODEL_NAME)
    return _model


def embed_texts(texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns list of 384-dim float vectors."""
    if not texts:
        return []
    model = _load_model()
    embeddings = model.encode(texts, show_progress_bar=False, normalize_embeddings=True)
    return embeddings.tolist()


def embed_query(text: str) -> list[float]:
    """Embed a single search query. Returns a 384-dim float vector."""
    model = _load_model()
    embedding = model.encode(text, show_progress_bar=False, normalize_embeddings=True)
    return embedding.tolist()
