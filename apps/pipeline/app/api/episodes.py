"""
Episode API — control-plane endpoints only.

POST  /api/episodes/ingest   Manually ingest a single audio URL
POST  /api/episodes/upload   Upload a local audio file for processing

Read-only episode data is served directly by the Next.js web app
via PostgreSQL queries (no proxy needed).
"""
import logging
import shutil
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.database import get_db
from app.models import Episode
from app.tasks.ingest import ingest_episode
from app import job_queue

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_EXTENSIONS = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".opus", ".aac", ".wma", ".webm"}


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


@router.post("/episodes/upload", status_code=202)
def upload_audio(
    file: UploadFile = File(...),
    title: str = Form(""),
    description: str = Form(""),
    db: Session = Depends(get_db),
) -> dict:
    """Upload a local audio file for processing through the pipeline."""
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    suffix = Path(file.filename).suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type '{suffix}'. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    # Disk space check
    try:
        usage = shutil.disk_usage(settings.data_dir)
        if usage.free < settings.disk_headroom_bytes:
            raise HTTPException(status_code=507, detail="Insufficient disk space for upload")
    except OSError:
        pass  # Non-fatal — proceed with upload

    # Use filename (without extension) as default title
    default_title = Path(file.filename).stem.replace("_", " ").replace("-", " ")
    episode_title = title.strip() or default_title
    episode_description = description.strip() or None

    episode = Episode(
        guid=f"upload:{file.filename}:{episode_title}",
        audio_url=f"local://{file.filename}",
        title=episode_title,
        description=episode_description,
        status="pending",
    )
    db.add(episode)
    db.flush()
    db.refresh(episode)

    # Save file to raw audio directory
    raw_dir = Path(settings.audio_raw_dir)
    raw_dir.mkdir(parents=True, exist_ok=True)
    dest = raw_dir / f"{episode.id}{suffix}"

    try:
        with open(dest, "wb") as fh:
            shutil.copyfileobj(file.file, fh)
    except OSError as exc:
        db.rollback()
        raise HTTPException(status_code=507, detail=f"Failed to save file: {exc}")

    episode.audio_local_path = str(dest)
    db.commit()

    # Skip download — file is already local, go straight to transcribe
    job_queue.enqueue(db, str(episode.id), "transcribe")

    logger.info(
        '"action": "upload_ingest", "episode_id": "%s", "filename": "%s"',
        episode.id, file.filename,
    )
    return {"episode_id": str(episode.id)}
