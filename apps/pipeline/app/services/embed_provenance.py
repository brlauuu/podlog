"""Records which model produced the corpus embeddings, and refuses mismatches (#945).

`_validate_vectors_dim` catches a *dimension* change. It cannot catch an
*identity* change: ``all-MiniLM-L6-v2`` and ``BAAI/bge-small-en-v1.5`` are both
384-dimensional and live in completely different vector spaces. Swap one for
the other and the dimension check passes, the write succeeds, the HNSW index
accepts the rows, nothing logs — and cosine similarity between the two
populations is meaningless. Measured on real data: re-embedding a segment's own
text with the wrong 384-dim model scores ~0.33 against its stored vector,
against 1.0000 for the right one.

The key is the **model name**, not the provider. Both providers served the same
underlying model, so a Fireworks-to-local switch on the same model name is
correctly seen as compatible (that is the #944 recovery path), while an
all-MiniLM/bge-small swap is incompatible whichever provider produced it.

One global record rather than a per-row column: a mixed corpus is the thing
being prevented, not a state worth modelling, and a column would cost a
migration over every existing segment.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemState

logger = logging.getLogger(__name__)

STATE_KEY = "embedding_model_state"


class EmbeddingModelMismatch(RuntimeError):
    """The configured embedding model differs from the one that built the corpus."""


def effective_model_name(runtime: dict[str, Any] | None = None) -> str:
    """The model identity in play, whichever provider is selected.

    Deliberately provider-agnostic: what matters for vector-space compatibility
    is which model produced the numbers, not who ran it.
    """

    def _value(key: str, default: Any) -> Any:
        if runtime is not None and runtime.get(key) is not None:
            return runtime[key]
        return default

    provider = _value("embedding_provider", settings.embedding_provider)
    if provider == "fireworks":
        return str(_value("fireworks_embedding_model", settings.fireworks_embedding_model))
    return str(_value("embedding_model", settings.embedding_model))


def read_state(db: Session) -> dict[str, Any] | None:
    """Return the recorded provenance, or None when nothing has been recorded."""
    row = db.query(SystemState).filter(SystemState.key == STATE_KEY).one_or_none()
    if row is None:
        return None
    try:
        state = json.loads(row.value)
    except (TypeError, ValueError):
        # A corrupt record must not wedge embedding forever; treat it as unset
        # so the next write re-adopts.
        logger.warning('"action": "embedding_provenance_unreadable"')
        return None
    return state if isinstance(state, dict) else None


def record_model(db: Session, model: str, dim: int) -> dict[str, Any]:
    """Write (or overwrite) the provenance record."""
    state = {
        "model": model,
        "dim": dim,
        "recorded_at": datetime.now(timezone.utc).isoformat(),
    }
    stmt = insert(SystemState).values(key=STATE_KEY, value=json.dumps(state))
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": json.dumps(state)}
    )
    db.execute(stmt)
    db.commit()
    return state


def mismatch_message(recorded: str, configured: str) -> str:
    return (
        f"Embedding model mismatch: this corpus was built with '{recorded}', but "
        f"'{configured}' is configured. Both may share a dimension while producing "
        "completely different vectors, so continuing would corrupt search silently "
        "rather than fail. Either set the embedding model back to "
        f"'{recorded}', or, if the change is deliberate, re-embed the corpus and "
        "let the new model be recorded. See issue #945."
    )


def assert_matches(db: Session, dim: int, runtime: dict[str, Any] | None = None) -> None:
    """Adopt the configured model on first use; refuse when it later differs.

    Raises :class:`EmbeddingModelMismatch`. On the write paths that surfaces as
    a failed job. On the query path it surfaces as a non-200 from ``/api/embed``,
    which the web app already degrades into FTS-only search (#928/#941) — so a
    mismatched config loses semantic results rather than returning meaningless
    ones.
    """
    configured = effective_model_name(runtime)
    state = read_state(db)

    if state is None or not state.get("model"):
        recorded = record_model(db, configured, dim)
        logger.info(
            '"action": "embedding_provenance_adopted", "model": "%s", "dim": %d',
            recorded["model"],
            recorded["dim"],
        )
        return

    if state["model"] != configured:
        logger.error(
            '"action": "embedding_model_mismatch", "recorded": "%s", "configured": "%s"',
            state["model"],
            configured,
        )
        raise EmbeddingModelMismatch(mismatch_message(state["model"], configured))
