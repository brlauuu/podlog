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
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode, Job
from app.services.pipeline_commands import enqueue_episode_ingest

logger = logging.getLogger(__name__)
router = APIRouter()

# Error classes that cannot be auto-retried -- user must resolve the root cause first
NON_RETRYABLE = {"DISK_FULL", "OOM", "MANUAL_UPLOAD_FILE_MISSING"}

# Terminal or known-idle statuses that are always safe to retry
_RETRYABLE_STATUSES = {"done", "failed", "pending"}

# Map job_queue.task → UI display status for active jobs.
TASK_TO_STATUS: dict[str, str] = {
    "download": "downloading",
    "transcribe": "transcribing",
    "diarize": "diarizing",
    "embed": "embedding",
    "infer": "inferring",
    "archive": "archiving",
}


def _rows(db: Session, sql: str) -> list[dict]:
    """Run a read-only SQL statement and return rows as dicts."""
    return [dict(row._mapping) for row in db.execute(text(sql)).all()]


@router.get("/queue")
def get_queue(db: Session = Depends(get_db)) -> dict:
    """Return the queue dashboard snapshot consumed by the web UI.

    Shape is the contract that `apps/web/src/components/QueueStatus.tsx`
    and its view-model helper depend on — do not change keys without
    coordinating a web-side update.
    """
    active_rows = _rows(
        db,
        """
        SELECT DISTINCT ON (e.id)
          e.id        AS episode_id,
          e.title,
          jq.task     AS active_task,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          jq.picked_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM job_queue jq
        JOIN episodes e ON e.id = jq.episode_id
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE jq.status = 'picked'
        ORDER BY e.id, jq.picked_at DESC
        """,
    )
    pending_rows = _rows(
        db,
        """
        SELECT DISTINCT ON (e.id)
          e.id        AS episode_id,
          e.title,
          jq.task     AS pending_task,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM job_queue jq
        JOIN episodes e ON e.id = jq.episode_id
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE jq.status = 'pending'
          AND e.status NOT IN ('done', 'failed')
          AND NOT EXISTS (
            SELECT 1 FROM job_queue jq2
            WHERE jq2.episode_id = e.id AND jq2.status = 'picked'
          )
        ORDER BY e.id, jq.created_at ASC
        """,
    )
    failed_rows = _rows(
        db,
        """
        SELECT
          e.id        AS episode_id,
          e.title,
          e.status,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM episodes e
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE e.status = 'failed'
        ORDER BY e.updated_at DESC
        """,
    )
    done_rows = _rows(
        db,
        """
        SELECT
          e.id        AS episode_id,
          e.title,
          e.status,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM episodes e
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE e.status = 'done'
        ORDER BY e.updated_at DESC
        LIMIT 50
        """,
    )
    stuck_rows = _rows(
        db,
        """
        SELECT
          e.id        AS episode_id,
          e.title,
          e.status,
          e.error_message,
          e.error_class,
          e.retry_count,
          e.retry_max,
          e.updated_at,
          f.mode      AS feed_mode,
          f.title     AS feed_title
        FROM episodes e
        LEFT JOIN feeds f ON f.id = e.feed_id
        WHERE e.status NOT IN ('done', 'failed')
          AND NOT EXISTS (
            SELECT 1 FROM job_queue jq
            WHERE jq.episode_id = e.id AND jq.status IN ('pending', 'picked')
          )
        ORDER BY e.updated_at DESC
        """,
    )
    done_count = db.execute(
        text("SELECT COUNT(*) AS count FROM episodes WHERE status = 'done'")
    ).scalar_one()

    for row in active_rows:
        row["status"] = TASK_TO_STATUS.get(row.get("active_task"), row.get("active_task"))
    for row in pending_rows:
        row["status"] = "pending"
    for row in stuck_rows:
        row["status"] = "stuck"

    return {
        "active_count": len(active_rows),
        "pending_count": len(pending_rows),
        "failed_count": len(failed_rows),
        "done_count": int(done_count or 0),
        "stuck_count": len(stuck_rows),
        "active_jobs": active_rows,
        "pending_jobs": pending_rows,
        "failed_jobs": failed_rows,
        "done_jobs": done_rows,
        "stuck_jobs": stuck_rows,
    }


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
