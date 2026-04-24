"""
DB-backed worker — replaces Celery worker.

Polls the job_queue table in a loop and dispatches to task handlers.
Also runs periodic tasks (feed polling, zombie cleanup) on a schedule.

Usage:
  python -m app.worker
"""
import logging
import signal
import time
from datetime import datetime, timezone

from app.database import SessionLocal
from app import job_queue
from app.services.meta_analysis import is_stale, recompute_and_store
from app.task_registry import (
    TASK_HANDLERS,
    PERIODIC_TASKS,
    validate_wiring,
)

logger = logging.getLogger(__name__)

POLL_INTERVAL = 2  # seconds between queue polls when idle

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info('"action": "worker_shutdown_requested", "signal": %d', signum)
    _shutdown = True


def _run_periodic_tasks(last_run: dict[str, datetime], now: datetime) -> None:
    for task in PERIODIC_TASKS:
        interval = task.get_interval()
        last = last_run.get(task.name)
        if last is None or (now - last).total_seconds() >= interval:
            try:
                task.run()
                last_run[task.name] = now
                logger.info('"action": "periodic_task_ran", "task": "%s"', task.name)
            except Exception:
                logger.exception('"action": "periodic_task_failed", "task": "%s"', task.name)
                last_run[task.name] = now


def run_idle_hook(db) -> None:
    """Run during idle poll cycles — recomputes the meta-analysis snapshot
    if the stale flag is set. Swallows exceptions so the worker poll loop
    is never interrupted.
    """
    try:
        if not is_stale(db):
            return
        started = time.time()
        recompute_and_store(db)
        duration_ms = int((time.time() - started) * 1000)
        logger.info(
            '"action": "meta_analysis_recomputed", "duration_ms": %d',
            duration_ms,
        )
    except Exception:
        logger.exception('"action": "meta_analysis_idle_hook_failed"')


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": %(message)s}',
    )

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info('"action": "worker_start"')

    from app.services.events import bus
    from app.services.digest import register_notification_handlers
    register_notification_handlers(bus)
    validate_wiring()

    last_periodic_run: dict[str, datetime] = {}

    while not _shutdown:
        now = datetime.now(timezone.utc)

        _run_periodic_tasks(last_periodic_run, now)

        db = SessionLocal()
        try:
            job = job_queue.poll(db)
            if job is None:
                run_idle_hook(db)
                db.close()
                time.sleep(POLL_INTERVAL)
                continue

            logger.info(
                '"action": "job_picked", "job_id": %d, "task": "%s", "episode_id": "%s"',
                job.id, job.task, job.episode_id,
            )

            handler = TASK_HANDLERS.get(job.task)
            if handler is None:
                job_queue.fail(db, job, f"Unknown task: {job.task}")
                continue

            try:
                handler(job.episode_id)
                job_queue.complete(db, job)
            except Exception as exc:
                logger.exception(
                    '"action": "job_error", "job_id": %d, "task": "%s", "error": "%s"',
                    job.id, job.task, str(exc),
                )
                job_queue.fail(db, job, str(exc))
        except Exception:
            logger.exception('"action": "worker_loop_error"')
        finally:
            db.close()

    logger.info('"action": "worker_stopped"')


if __name__ == "__main__":
    main()
