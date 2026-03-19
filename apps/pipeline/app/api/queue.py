"""
Queue management API — control-plane endpoints only.

POST  /api/queue/{episode_id}/retry      Retry a failed job

Queue read (GET /api/queue) is served directly by the Next.js web app
via PostgreSQL queries (no proxy needed).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode
from app.tasks.ingest import ingest_episode

logger = logging.getLogger(__name__)
router = APIRouter()

# Error classes that cannot be auto-retried -- user must resolve the root cause first
NON_RETRYABLE = {"DISK_FULL", "OOM"}


@router.post("/queue/{episode_id}/retry", status_code=202)
def retry_job(episode_id: str, db: Session = Depends(get_db)) -> dict:
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Job not found")

    if episode.status != "failed" and episode.error_class is None:
        raise HTTPException(status_code=409, detail="Job has no error to retry")

    if episode.error_class in NON_RETRYABLE:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot retry -- resolve the underlying issue first ({episode.error_class})",
        )

    # Reset state and re-enqueue
    episode.status = "pending"
    episode.error_message = None
    episode.error_class = None
    db.commit()

    ingest_episode(episode.id)

    logger.info('"action": "manual_retry", "episode_id": "%s"', episode.id)
    return {"queued": True, "episode_id": episode.id}
