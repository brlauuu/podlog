"""
Episode API -- PRD-01 S10

POST  /api/episodes/ingest   Manually ingest a single audio URL
GET   /api/episodes           List episodes (filterable by feed, status)
GET   /api/episodes/{id}      Get episode detail + segments
"""
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode, Segment, SpeakerName
from app.tasks.ingest import ingest_episode

logger = logging.getLogger(__name__)
router = APIRouter()


class IngestEpisodeRequest(BaseModel):
    audio_url: str
    title: Optional[str] = None


class SegmentResponse(BaseModel):
    id: int
    start_time: float
    end_time: float
    speaker_label: Optional[str]
    text: str

    model_config = {"from_attributes": True}


class EpisodeResponse(BaseModel):
    id: str
    feed_id: Optional[str]
    title: Optional[str]
    published_at: Optional[str]
    duration_secs: Optional[int]
    audio_url: str
    audio_local_path: Optional[str]
    language: Optional[str]
    status: str
    error_message: Optional[str]
    error_class: Optional[str]
    retry_count: int
    has_diarization: bool
    diarization_error: Optional[str]
    created_at: str
    updated_at: str
    processed_at: Optional[str]

    model_config = {"from_attributes": True}


class EpisodeDetailResponse(EpisodeResponse):
    segments: list[SegmentResponse] = []


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


@router.get("/episodes", response_model=list[EpisodeResponse])
def list_episodes(
    feed_id: Optional[str] = Query(None),
    status: Optional[str] = Query(None),
    limit: int = Query(50, le=200),
    offset: int = Query(0),
    db: Session = Depends(get_db),
) -> list[EpisodeResponse]:
    q = db.query(Episode)
    if feed_id:
        q = q.filter(Episode.feed_id == feed_id)
    if status:
        q = q.filter(Episode.status == status)
    episodes = q.order_by(Episode.created_at.desc()).offset(offset).limit(limit).all()
    return [EpisodeResponse.model_validate(ep) for ep in episodes]


@router.get("/episodes/{episode_id}", response_model=EpisodeDetailResponse)
def get_episode(episode_id: str, db: Session = Depends(get_db)) -> EpisodeDetailResponse:
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    return EpisodeDetailResponse.model_validate(episode)
