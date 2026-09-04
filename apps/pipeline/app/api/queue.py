"""
Queue management API.

GET   /api/queue                         Queue dashboard snapshot
POST  /api/queue/{episode_id}/retry      Retry a failed/stuck/done job

The queue dashboard read (GET /api/queue) lives in the pipeline so that
job_queue schema and the web app stay on opposite sides of a stable
HTTP contract. Web's /api/queue route is a thin proxy (#555).
"""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode, Job
from app.services.pipeline_commands import enqueue_episode_ingest
from app.services.queue_snapshot import TASK_TO_STATUS, queue_snapshot  # noqa: F401 -- re-exported

logger = logging.getLogger(__name__)
router = APIRouter()

# Error classes that cannot be auto-retried -- user must resolve the root cause first
# Error classes where the Retry button is suppressed server-side: retrying
# cannot change the outcome. Mirrored in the web app's
# apps/web/src/lib/queueStatus.ts::NON_RETRYABLE, which hides the button; a
# parity test asserts the two match. Note this is a DIFFERENT set from
# tasks/helpers.py::_NON_RETRYABLE, which governs *automatic* retry.
NON_RETRYABLE = {"DISK_FULL", "OOM", "MANUAL_UPLOAD_FILE_MISSING", "NO_SPEECH"}

# Terminal or known-idle statuses that are always safe to retry
_RETRYABLE_STATUSES = {"done", "failed", "pending"}

@router.get("/queue")
def get_queue(db: Session = Depends(get_db)) -> dict:
    """Return the queue dashboard snapshot consumed by the web UI.

    The query lives in `services/queue_snapshot.py` so the Telegram bot can
    share it (#1034); the response shape is unchanged.
    """
    return queue_snapshot(db)


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
