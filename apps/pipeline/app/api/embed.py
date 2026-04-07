"""Embedding API — exposes query embedding for the web app's semantic search."""

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.services.notification_settings import get_runtime_embedding_settings

router = APIRouter(tags=["embed"])


class EmbedRequest(BaseModel):
    text: str


class EmbedResponse(BaseModel):
    embedding: list[float]


@router.post("/embed", response_model=EmbedResponse)
async def embed_text(req: EmbedRequest, db: Session = Depends(get_db)):
    from app.services.embed import embed_query

    runtime = get_runtime_embedding_settings(db)
    embedding = embed_query(req.text, runtime=runtime)
    return EmbedResponse(embedding=embedding)
