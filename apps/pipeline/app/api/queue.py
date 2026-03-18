"""
Queue management API — PRD-01 §10

GET   /api/queue                    Current queue state
POST  /api/queue/{task_id}/retry    Retry a failed job
"""
import logging
from typing import Optional

from celery.result import AsyncResult
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode
from app.tasks.celery_app import celery_app
from app.tasks.ingest import ingest_episode

logger = logging.getLogger(__name__)
router = APIRouter()

# Error classes that cannot be auto-retried — user must resolve the root cause first
NON_RETRYABLE = {"DISK_FULL", "OOM"}

ACTIVE_STATUSES = ["downloading", "transcribing", "diarizing", "inferring", "archiving"]


class QueueStateResponse(BaseModel):
    active_count: int
    pending_count: int
    failed_count: int
    done_count: int
    active_jobs: list[dict]
    pending_jobs: list[dict]
    failed_jobs: list[dict]
    done_jobs: list[dict]


def _job_dict(ep) -> dict:
    """Convert an Episode to a dict for the queue API response."""
    return {
        "episode_id": ep.id,
        "title": ep.title,
        "status": ep.status,
        "celery_task_id": ep.celery_task_id,
        "error_message": ep.error_message,
        "error_class": ep.error_class,
        "retry_count": ep.retry_count,
        "retry_max": ep.retry_max,
        "feed_mode": ep.feed.mode if ep.feed else None,
        "feed_title": ep.feed.title if ep.feed else None,
        "updated_at": ep.updated_at.isoformat() if ep.updated_at else None,
    }


@router.get("/queue", response_model=QueueStateResponse)
def get_queue(db: Session = Depends(get_db)) -> QueueStateResponse:
    active = db.query(Episode).filter(
        Episode.status.in_(ACTIVE_STATUSES)
    ).all()
    pending = db.query(Episode).filter(Episode.status == "pending").all()
    failed = db.query(Episode).filter(Episode.status == "failed").all()

    # Total count (unlimited) for display
    done_count = db.query(func.count(Episode.id)).filter(
        Episode.status == "done"
    ).scalar() or 0

    # Limited result set for the response
    done = db.query(Episode).filter(
        Episode.status == "done"
    ).order_by(Episode.updated_at.desc()).limit(50).all()

    return QueueStateResponse(
        active_count=len(active),
        pending_count=len(pending),
        failed_count=len(failed),
        done_count=done_count,
        active_jobs=[_job_dict(ep) for ep in active],
        pending_jobs=[_job_dict(ep) for ep in pending],
        failed_jobs=[_job_dict(ep) for ep in failed],
        done_jobs=[_job_dict(ep) for ep in done],
    )


@router.post("/queue/{task_id}/retry", status_code=202)
def retry_job(task_id: str, db: Session = Depends(get_db)) -> dict:
    episode = db.query(Episode).filter(Episode.celery_task_id == task_id).first()
    if not episode:
        raise HTTPException(status_code=404, detail="Job not found")

    if episode.status != "failed" and episode.error_class is None:
        raise HTTPException(status_code=409, detail="Job has no error to retry")

    if episode.error_class in NON_RETRYABLE:
        raise HTTPException(
            status_code=422,
            detail=f"Cannot retry — resolve the underlying issue first ({episode.error_class})",
        )

    # Reset state and re-enqueue
    episode.status = "pending"
    episode.error_message = None
    episode.error_class = None
    db.commit()

    result = ingest_episode.delay(episode.id)
    episode.celery_task_id = result.id
    db.commit()

    logger.info('"action": "manual_retry", "episode_id": "%s"', episode.id)
    return {"queued": True, "task_id": result.id}
