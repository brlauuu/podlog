"""
Zombie job cleanup task -- GAP-01 / RISK-01.

Only jobs in 'picked' status (actually running) can be zombies. Jobs still
in 'pending' (waiting in queue) are never marked as zombies — they simply
haven't had their turn yet.

Expected runtime is derived from the episode's audio duration and a
configurable realtime factor. A job is marked zombie when it has been
running longer than expected_runtime × zombie_timeout_multiplier.

Per PRD-01 S5.9: stalled jobs are classified as SYSTEM_ERROR.
"""
import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


def cleanup_zombie_jobs() -> dict:
    """Mark picked jobs that have been running far too long as failed."""
    from app.config import settings
    from app.database import SessionLocal
    from app.models import Episode, Job

    db = SessionLocal()
    try:
        now = datetime.now(timezone.utc)
        min_timeout = timedelta(minutes=settings.zombie_min_timeout_minutes)

        # Only look at jobs that are actually running (picked), never pending
        picked_jobs = (
            db.query(Job)
            .filter(Job.status == "picked", Job.picked_at.isnot(None))
            .all()
        )

        if not picked_jobs:
            return {"marked_failed": 0}

        failed_episode_ids = []
        failed_job_ids = []

        for job in picked_jobs:
            episode = db.query(Episode).filter(Episode.id == job.episode_id).first()
            if not episode:
                continue

            # Calculate expected runtime from audio duration
            if episode.duration_secs and episode.duration_secs > 0:
                expected_secs = episode.duration_secs * settings.zombie_realtime_factor
                timeout = timedelta(seconds=expected_secs * settings.zombie_timeout_multiplier)
                # Apply minimum floor
                if timeout < min_timeout:
                    timeout = min_timeout
            else:
                timeout = min_timeout

            running_for = now - job.picked_at
            if running_for > timeout:
                running_mins = running_for.total_seconds() / 60
                timeout_mins = timeout.total_seconds() / 60

                # Mark the job as failed
                job.status = "failed"
                job.error = (
                    f"Zombie: job ran for {running_mins:.0f}min, "
                    f"exceeding {timeout_mins:.0f}min timeout "
                    f"(task={job.task}, worker may have been killed by OOM or SIGKILL). "
                    "Re-enqueue to retry."
                )

                # Mark the episode as failed
                episode.status = "failed"
                episode.error_class = "SYSTEM_ERROR"
                episode.error_message = job.error
                episode.updated_at = now

                failed_episode_ids.append(episode.id)
                failed_job_ids.append(job.id)

        if failed_job_ids:
            db.commit()
            logger.warning(
                "Zombie job cleanup: marked %d job(s) as failed (job_ids=%s, episode_ids=%s)",
                len(failed_job_ids),
                failed_job_ids,
                failed_episode_ids,
            )
        return {
            "marked_failed": len(failed_job_ids),
            "job_ids": failed_job_ids,
            "episode_ids": failed_episode_ids,
        }
    except Exception:
        db.rollback()
        logger.exception("Zombie job cleanup task failed unexpectedly")
        raise
    finally:
        db.close()
