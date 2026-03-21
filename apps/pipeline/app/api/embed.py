"""Embedding API — exposes query embedding for the web app's semantic search."""

from fastapi import APIRouter
from pydantic import BaseModel

router = APIRouter(tags=["embed"])


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]


@router.post("/embed", response_model=EmbedResponse)
async def embed_text(req: EmbedRequest):
    from app.services.embed import embed_query

    embedding = embed_query(req.text)
    return EmbedResponse(embedding=embedding)
