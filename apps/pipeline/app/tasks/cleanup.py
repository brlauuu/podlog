"""
Zombie job cleanup task — GAP-01 / RISK-01.

If the worker process is killed with SIGKILL (e.g. by the Linux OOM killer)
while processing a job, Celery cannot catch the exception and the episode
remains in a non-terminal status indefinitely. This task runs periodically
and marks any such stalled episodes as failed so the user can see the problem
and retry manually.

Per PRD-01 §5.9: stalled jobs are classified as SYSTEM_ERROR.
"""
import logging
from datetime import datetime, timedelta, timezone

from app.tasks.celery_app import celery_app

logger = logging.getLogger(__name__)

# Statuses that should always progress. If an episode is stuck in one of these
# for longer than ZOMBIE_TIMEOUT_HOURS it means the worker died mid-job.
NON_TERMINAL_STATUSES = ("pending", "downloading", "transcribing", "diarizing", "archiving")
ZOMBIE_TIMEOUT_HOURS = 2


@celery_app.task(name="cleanup_zombie_jobs")
def cleanup_zombie_jobs() -> dict:
    """Mark episodes stuck in non-terminal states for >2 hours as failed."""
    from app.database import SessionLocal
    from app.models import Episode

    db = SessionLocal()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(hours=ZOMBIE_TIMEOUT_HOURS)

        stalled = (
            db.query(Episode)
            .filter(
                Episode.status.in_(NON_TERMINAL_STATUSES),
                Episode.updated_at < cutoff,
            )
            .all()
        )

        if not stalled:
            return {"marked_failed": 0}

        ids = [ep.id for ep in stalled]
        for ep in stalled:
            ep.status = "failed"
            ep.error_class = "SYSTEM_ERROR"
            ep.error_message = (
                f"Job stalled in '{ep.status}' state — worker may have been killed (OOM or SIGKILL). "
                "Reset status to 'pending' to retry."
            )
            ep.updated_at = datetime.now(timezone.utc)

        db.commit()
        logger.warning(
            "Zombie job cleanup: marked %d episode(s) as failed",
            len(ids),
            extra={"episode_ids": ids},
        )
        return {"marked_failed": len(ids), "episode_ids": ids}
    except Exception:
        db.rollback()
        logger.exception("Zombie job cleanup task failed unexpectedly")
        raise
    finally:
        db.close()
