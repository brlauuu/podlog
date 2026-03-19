"""
Episode API — control-plane endpoints only.

POST  /api/episodes/ingest   Manually ingest a single audio URL

Read-only episode data is served directly by the Next.js web app
via PostgreSQL queries (no proxy needed).
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode
from app.tasks.ingest import ingest_episode

logger = logging.getLogger(__name__)
router = APIRouter()


class IngestEpisodeRequest(BaseModel):
    audio_url: str
    title: Optional[str] = None


@router.post("/episodes/ingest", status_code=202)
def ingest_manual(body: IngestEpisodeRequest, db: Session = Depends(get_db)) -> dict:
    """Manually ingest a single audio URL (no RSS feed required)."""
    existing = db.query(Episode).filter(Episode.audio_url == body.audio_url).first()
    if existing:
        raise HTTPException(status_code=409, detail="Episode already ingested")

    episode = Episode(
        guid=body.audio_url,  # Use URL as GUID for manually added episodes
        audio_url=body.audio_url,
        title=body.title or body.audio_url,
        status="pending",
    )
    db.add(episode)
    db.commit()
    db.refresh(episode)

    ingest_episode(episode.id)
    logger.info('"action": "manual_ingest", "episode_id": "%s"', episode.id)
    return {"episode_id": episode.id}
