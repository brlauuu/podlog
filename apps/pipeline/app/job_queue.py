"""
DB-backed job queue — replaces Celery/Redis.

Uses PostgreSQL FOR UPDATE SKIP LOCKED for safe concurrent polling.
Jobs flow through: pending -> picked -> (task runs) -> done/failed.
"""
import logging
from datetime import datetime, timezone

from sqlalchemy import case
from sqlalchemy.orm import Session

from app.models import Job

logger = logging.getLogger(__name__)

# Later pipeline stages get higher priority (lower number = picked first)
# so an episode already in progress finishes before new ones start.
TASK_PRIORITY = {
    "archive": 0,
    "infer": 1,
    "embed": 2,
    "diarize": 3,
    "transcribe": 4,
    "download": 5,
}
_DEFAULT_PRIORITY = 99


def enqueue(db: Session, episode_id: str, task: str, retry_at: datetime | None = None) -> Job:
    """Add a job to the queue. Returns the created Job row."""
    job = Job(episode_id=episode_id, task=task, retry_at=retry_at)
    db.add(job)
    db.commit()
    db.refresh(job)
    logger.info(
        '"action": "job_enqueued", "job_id": %d, "episode_id": "%s", "task": "%s"',
        job.id, episode_id, task,
    )
    return job


def poll(db: Session) -> Job | None:
    """
    Claim the next ready job using FOR UPDATE SKIP LOCKED.

    Priority: later pipeline stages first (archive > infer > ... > download),
    then FIFO within each stage. This ensures episodes complete their full
    pipeline before new ones start, preventing stage starvation.

    Returns None if no jobs are available. The returned job has
    status='picked' and picked_at set.
    """
    now = datetime.now(timezone.utc)
    priority = case(
        {task: prio for task, prio in TASK_PRIORITY.items()},
        value=Job.task,
        else_=_DEFAULT_PRIORITY,
    )
    job = (
        db.query(Job)
        .filter(
            Job.status == "pending",
            (Job.retry_at <= now) | (Job.retry_at.is_(None)),
        )
        .order_by(priority, Job.created_at)
        .with_for_update(skip_locked=True)
        .first()
    )
    if job is None:
        return None

    job.status = "picked"
    job.picked_at = now
    job.attempt += 1
    db.commit()
    db.refresh(job)
    return job


def complete(db: Session, job: Job) -> None:
    """Mark a job as successfully completed."""
    job.status = "done"
    db.commit()
    logger.info('"action": "job_complete", "job_id": %d, "task": "%s"', job.id, job.task)


def fail(db: Session, job: Job, error: str) -> None:
    """Mark a job as failed."""
    job.status = "failed"
    job.error = error
    db.commit()
    logger.error(
        '"action": "job_failed", "job_id": %d, "task": "%s", "error": "%s"',
        job.id, job.task, error,
    )
