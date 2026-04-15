"""
Queue management API — control-plane endpoints only.

POST  /api/queue/{episode_id}/retry      Retry a failed/stuck/done job

Queue read (GET /api/queue) is served directly by the Next.js web app
via PostgreSQL queries (no proxy needed).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode, Job
from app.services.pipeline_commands import enqueue_episode_ingest

logger = logging.getLogger(__name__)
router = APIRouter()

# Error classes that cannot be auto-retried -- user must resolve the root cause first
NON_RETRYABLE = {"DISK_FULL", "OOM"}

# Terminal or known-idle statuses that are always safe to retry
_RETRYABLE_STATUSES = {"done", "failed", "pending"}


@router.post("/queue/{episode_id}/retry", status_code=202)
def retry_job(episode_id: str, db: Session = Depends(get_db)) -> dict:
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Job not found")

    if episode.error_class in NON_RETRYABLE:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot retry -- resolve the underlying issue first ({episode.error_class})",
        )

    if episode.status not in _RETRYABLE_STATUSES:
        # Intermediate status (downloading, transcribing, etc.) — only allow if
        # there's no active queue entry (i.e. the episode is stuck/orphaned)
        has_active_job = (
            db.query(Job)
            .filter(Job.episode_id == episode_id, Job.status.in_(["pending", "picked"]))
            .first()
        ) is not None
        if has_active_job:
            raise HTTPException(status_code=409, detail="Episode is still being processed")

    # Reset state and re-enqueue
    episode.status = "pending"
    episode.error_message = None
    episode.error_class = None
    episode.retry_count = 0
    episode.diarization_error = None
    episode.has_diarization = False
    episode.transcribe_duration_secs = None
    episode.diarize_duration_secs = None
    episode.diarize_step_durations = None
    # Clear inference provider so fresh config is picked up on reprocess (Issue #436)
    episode.inference_provider_used = None
    db.commit()

    enqueue_episode_ingest(db, str(episode.id))

    logger.info('"action": "manual_retry", "episode_id": "%s"', episode.id)
    return {"queued": True, "episode_id": episode.id}
