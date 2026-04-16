"""
Episode API — control-plane endpoints only.

POST   /api/episodes/ingest        Manually ingest a single audio URL
POST   /api/episodes/upload        Upload a local audio file for processing
DELETE /api/episodes/{episode_id}  Delete a manually uploaded episode

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
from app import job_queue
from app.services.pipeline_commands import enqueue_episode_ingest

logger = logging.getLogger(__name__)
router = APIRouter()

ALLOWED_EXTENSIONS = {".mp3", ".m4a", ".wav", ".ogg", ".flac", ".opus", ".aac", ".wma", ".webm", ".mp4"}


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

    enqueue_episode_ingest(db, str(episode.id))
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


@router.delete("/episodes/{episode_id}", status_code=204)
def delete_episode(episode_id: str, db: Session = Depends(get_db)) -> None:
    """Delete a manually uploaded episode (issue #454).

    Restricted to episodes with feed_id IS NULL — feed-linked episodes
    should be removed by deleting the feed (DELETE /api/feeds/{id}?delete_episodes=true).
    Removes on-disk audio + transcript; DB cascade handles segments, chunks,
    speaker_names, jobs, and notifications.
    """
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Episode not found")
    if episode.feed_id is not None:
        raise HTTPException(
            status_code=403,
            detail="Feed-linked episodes can only be deleted by removing the feed",
        )

    _remove_episode_files(episode_id, episode.audio_local_path, episode.transcript_path)

    db.delete(episode)
    db.commit()
    logger.info('"action": "episode_deleted", "episode_id": "%s"', episode_id)


def _remove_episode_files(
    episode_id: str,
    audio_local_path: Optional[str],
    transcript_path: Optional[str],
) -> None:
    """Best-effort removal of files associated with an episode.

    Only unlinks files under the configured audio/transcript directories —
    any path outside those roots is ignored as a safety measure.
    """
    allowed_roots = [
        Path(settings.audio_raw_dir).resolve(),
        Path(settings.audio_archive_dir).resolve(),
        Path(settings.transcript_dir).resolve(),
    ]

    def _unlink_if_allowed(p: Path) -> None:
        try:
            resolved = p.resolve()
        except OSError:
            return
        if not any(str(resolved).startswith(str(root) + "/") for root in allowed_roots):
            return
        try:
            resolved.unlink(missing_ok=True)
        except OSError as exc:
            logger.warning(
                '"action": "episode_file_unlink_failed", "episode_id": "%s", "path": "%s", "error": "%s"',
                episode_id, resolved, exc,
            )

    # Explicit paths recorded on the row
    if audio_local_path:
        _unlink_if_allowed(Path(audio_local_path))
    if transcript_path:
        _unlink_if_allowed(Path(transcript_path))

    # Defensive sweep — any {episode_id}.* in raw/, {episode_id}.mp3 in archive/
    raw_dir = Path(settings.audio_raw_dir)
    if raw_dir.is_dir():
        for path in raw_dir.glob(f"{episode_id}.*"):
            _unlink_if_allowed(path)
    archive_file = Path(settings.audio_archive_dir) / f"{episode_id}.mp3"
    if archive_file.exists():
        _unlink_if_allowed(archive_file)
