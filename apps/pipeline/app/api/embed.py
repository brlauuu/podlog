"""Embedding API — query embedding for search, plus corpus-provenance introspection."""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Segment
from app.services.notification_settings import get_runtime_embedding_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["embed"])


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]


class ModelStateResponse(BaseModel):
    recorded_model: str | None
    configured_model: str
    dim: int | None
    recorded_at: str | None
    matches: bool
    embedded_segments: int


class VerifyRequest(BaseModel):
    sample_size: int = 5


class VerifyResponse(BaseModel):
    sampled: int
    mean_cosine: float | None
    matches: bool | None
    configured_model: str
    recorded_model: str | None
    detail: str


@router.post("/embed", response_model=EmbedResponse)
async def embed_text(req: EmbedRequest, db: Session = Depends(get_db)):
    from app.services.embed import embed_query

    runtime = get_runtime_embedding_settings(db)
    embedding = embed_query(req.text, runtime=runtime, db=db)
    return EmbedResponse(embedding=embedding)


@router.get("/embed/model-state", response_model=ModelStateResponse)
async def embed_model_state(db: Session = Depends(get_db)):
    """Report which model built the corpus versus which one is configured (#945)."""
    from app.services.embed_provenance import effective_model_name, read_state

    runtime = get_runtime_embedding_settings(db)
    configured = effective_model_name(runtime)
    state = read_state(db) or {}
    recorded = state.get("model")
    embedded = db.execute(
        select(func.count()).select_from(Segment).where(Segment.embedding.isnot(None))
    ).scalar_one()

    return ModelStateResponse(
        recorded_model=recorded,
        configured_model=configured,
        dim=state.get("dim"),
        recorded_at=state.get("recorded_at"),
        # Nothing recorded yet is not a mismatch — the next embed adopts.
        matches=recorded is None or recorded == configured,
        embedded_segments=int(embedded),
    )


@router.post("/embed/verify", response_model=VerifyResponse)
async def embed_verify(req: VerifyRequest, db: Session = Depends(get_db)):
    """Re-embed stored segments and compare against their stored vectors (#945).

    The provenance record is a claim about the past; this is the only thing that
    checks it against reality. It is also how the corpus model was identified in
    the first place — the wrong 384-dim model scores ~0.33 here, the right one
    scores 1.0.
    """
    from app.services.embed_provenance import effective_model_name, read_state

    runtime = get_runtime_embedding_settings(db)
    configured = effective_model_name(runtime)
    recorded = (read_state(db) or {}).get("model")

    sample_size = max(1, min(50, req.sample_size))
    rows = db.execute(
        select(Segment.text, Segment.embedding)
        .where(Segment.embedding.isnot(None), func.length(Segment.text) > 40)
        .order_by(Segment.id.desc())
        .limit(sample_size)
    ).all()

    if not rows:
        return VerifyResponse(
            sampled=0,
            mean_cosine=None,
            matches=None,
            configured_model=configured,
            recorded_model=recorded,
            detail="No embedded segments to verify against.",
        )

    # Bypasses the guard on purpose: verification must still work when the
    # configured model mismatches, since telling the operator how badly it
    # differs is the entire point.
    fresh = _embed_bypassing_guard([r[0] for r in rows], runtime)

    cosines = [_cosine(list(stored), new) for (_, stored), new in zip(rows, fresh)]
    mean = sum(cosines) / len(cosines)
    matches = mean > 0.99

    logger.info(
        '"action": "embedding_verify", "sampled": %d, "mean_cosine": %.4f, "matches": %s',
        len(cosines),
        mean,
        str(matches).lower(),
    )

    return VerifyResponse(
        sampled=len(cosines),
        mean_cosine=round(mean, 4),
        matches=matches,
        configured_model=configured,
        recorded_model=recorded,
        detail=(
            "Configured model reproduces the stored vectors."
            if matches
            else "Configured model does NOT reproduce the stored vectors — semantic "
            "search will return meaningless results. Set the embedding model back "
            "to the one that built the corpus, or re-embed."
        ),
    )


def _embed_bypassing_guard(texts: list[str], runtime: dict) -> list[list[float]]:
    from app.services import embed as embed_mod

    provider = embed_mod._runtime_value(
        runtime, "embedding_provider", embed_mod.settings.embedding_provider
    )
    if provider == "fireworks":
        return embed_mod._embed_texts_fireworks(texts, runtime)

    model_name = embed_mod._runtime_value(
        runtime, "embedding_model", embed_mod.settings.embedding_model
    )
    model = embed_mod._load_model(model_name)
    return model.encode(texts, show_progress_bar=False, normalize_embeddings=True).tolist()


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = sum(x * x for x in a) ** 0.5
    nb = sum(y * y for y in b) ** 0.5
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)
