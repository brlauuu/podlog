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
from collections import Counter
from datetime import datetime, timedelta, timezone

from sqlalchemy import text

logger = logging.getLogger(__name__)


def cleanup_zombie_jobs() -> dict:
    """Mark picked jobs that have been running far too long as failed."""
    from app.config import settings
    from app.database import SessionLocal
    from app.models import Episode, Job
    from app.tasks.helpers import mark_failed

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

                # Mark the episode as failed (emits notification)
                mark_failed(
                    db, str(episode.id),
                    error_class="SYSTEM_ERROR",
                    error_message=job.error,
                )

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


# Issue #598: a 'failed' job_queue row is purely historical once a later attempt
# at the same task succeeds, or once the episode itself has reached 'done'. The
# row count fed the queue dashboard's "failed" counter and made real failures
# hard to spot. Pruning these keeps the counter actionable without losing any
# in-flight or unresolved-failure context.
_PRUNE_SUPERSEDED_FAILED_JOBS_SQL = text("""
WITH deleted AS (
  DELETE FROM job_queue f
  WHERE f.status = 'failed'
    AND (
      EXISTS (
        SELECT 1 FROM job_queue d
        WHERE d.episode_id = f.episode_id
          AND d.task = f.task
          AND d.status = 'done'
          AND d.id > f.id
      )
      OR EXISTS (
        SELECT 1 FROM episodes e
        WHERE e.id = f.episode_id
          AND e.status = 'done'
          AND e.processed_at IS NOT NULL
          AND f.picked_at IS NOT NULL
          AND e.processed_at > f.picked_at
      )
    )
  RETURNING task
)
SELECT task, COUNT(*) AS count FROM deleted GROUP BY task ORDER BY task
""")


# Issue #641: episodes can end up "stranded" — sitting in a mid-pipeline
# status (e.g. ``embedding``) with no active job in the queue. This used
# to happen when a transient task error escaped the worker without retry.
# Worker-loop retry now handles the common case, but this sweep is the
# safety net for anything that still slips through (worker SIGKILL
# between commit and enqueue, future tasks introduced without classification,
# pre-fix stragglers from before the worker upgrade).
_STATUS_TO_TASK = {
    "downloading": "download",
    "transcribing": "transcribe",
    "diarizing": "diarize",
    "chunking": "chunk",
    "embedding": "embed",
    "inferring": "infer",
    "archiving": "archive",
}

_TERMINAL_OR_PIPELINE_STATUSES = frozenset(
    {"done", "failed", "pending"} | set(_STATUS_TO_TASK.keys())
)


def _resolve_stranded_task(status: str) -> str | None:
    """Map an episode status to the task that should be re-enqueued.

    Returns None when the status doesn't have a known re-enqueue point —
    in that case the sweep skips the row and logs it for human review.
    """
    if status in _STATUS_TO_TASK:
        return _STATUS_TO_TASK[status]
    # ``downloading:NN%`` is a progress-tagged variant of ``downloading``.
    if status.startswith("downloading"):
        return "download"
    return None


def recover_stranded_episodes() -> dict:
    """Re-enqueue episodes stuck in mid-pipeline statuses with no active job.

    "Stranded" = ``status NOT IN ('done','failed','pending')`` AND no row
    in ``job_queue`` for that episode in ``status IN ('pending','picked')``.

    This is a safety net layered behind the worker-loop transient retry
    (issue #641). It runs every 30 minutes by default. If something
    catches an episode mid-stage without enqueueing a follow-up — say a
    SIGKILL between ``db.commit()`` and ``job_queue.enqueue`` — this
    sweep notices it within the next interval.
    """
    from app import job_queue
    from app.database import SessionLocal
    from app.models import Episode, Job

    db = SessionLocal()
    try:
        stranded = (
            db.query(Episode)
            .filter(~Episode.status.in_(["done", "failed", "pending"]))
            .filter(
                ~db.query(Job)
                .filter(Job.episode_id == Episode.id)
                .filter(Job.status.in_(["pending", "picked"]))
                .exists()
            )
            .all()
        )

        recovered: list[str] = []
        unmapped: list[tuple[str, str]] = []  # (episode_id, status) pairs we skipped

        for episode in stranded:
            task = _resolve_stranded_task(episode.status)
            if task is None:
                unmapped.append((str(episode.id), episode.status))
                continue
            episode.status = "pending"
            db.flush()
            job_queue.enqueue(db, str(episode.id), task)
            recovered.append(str(episode.id))

        if recovered or unmapped:
            db.commit()
            logger.warning(
                'action=recover_stranded_episodes recovered=%d unmapped=%d '
                'recovered_ids=%s unmapped=%s',
                len(recovered), len(unmapped),
                recovered[:10], unmapped[:10],
            )
        return {
            "recovered": len(recovered),
            "recovered_ids": recovered,
            "unmapped": len(unmapped),
            "unmapped_pairs": unmapped,
        }
    except Exception:
        db.rollback()
        logger.exception("recover_stranded_episodes failed unexpectedly")
        raise
    finally:
        db.close()


def prune_superseded_failed_jobs() -> dict:
    """Delete `failed` job_queue rows that have been superseded by a later success.

    A row is superseded when either:
      1. There is a later row for the same `(episode_id, task)` whose status is `done`, OR
      2. The episode itself is `status='done'` and reached `processed_at`
         after this row was picked.

    Both cases mean the failure was recovered from. The remaining `failed`
    rows are the ones a human still needs to look at.
    """
    from app.database import SessionLocal

    db = SessionLocal()
    try:
        rows = db.execute(_PRUNE_SUPERSEDED_FAILED_JOBS_SQL).fetchall()
        db.commit()

        per_task: Counter[str] = Counter()
        for task_name, count in rows:
            per_task[task_name] = int(count)
        total = sum(per_task.values())

        if total > 0:
            logger.info(
                'action=prune_superseded_failed_jobs total=%d per_task=%s',
                total, dict(per_task),
            )
        return {"total": total, "per_task": dict(per_task)}
    except Exception:
        db.rollback()
        logger.exception("prune_superseded_failed_jobs failed unexpectedly")
        raise
    finally:
        db.close()
