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

from app.config import settings
from app.database import SessionLocal
from app import job_queue

logger = logging.getLogger(__name__)

# Task name -> handler function (lazily resolved to avoid circular imports)
TASK_HANDLERS: dict[str, str] = {
    "download": "app.tasks.download:download_episode",
    "transcribe": "app.tasks.transcribe:transcribe_episode",
    "diarize": "app.tasks.diarize:diarize_episode",
    "embed": "app.tasks.embed:embed_episode",
    "infer": "app.tasks.infer:infer_speakers",
    "archive": "app.tasks.archive:archive_episode",
}

POLL_INTERVAL = 2  # seconds between queue polls when idle
PERIODIC_TASKS = [
    # (name, function_path, interval_seconds)
    ("poll_all_feeds", "app.tasks.ingest:poll_all_feeds", None),  # interval set from settings
    ("cleanup_zombie_jobs", "app.tasks.cleanup:cleanup_zombie_jobs", 30 * 60),
]

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info('"action": "worker_shutdown_requested", "signal": %d', signum)
    _shutdown = True


def _resolve_handler(dotted_path: str):
    """Resolve 'module.path:function_name' to a callable."""
    module_path, func_name = dotted_path.rsplit(":", 1)
    import importlib
    mod = importlib.import_module(module_path)
    return getattr(mod, func_name)


def _run_periodic_tasks(last_run: dict[str, datetime], now: datetime) -> None:
    """Run any periodic tasks that are due."""
    for name, func_path, interval_secs in PERIODIC_TASKS:
        if interval_secs is None:
            interval_secs = settings.feed_poll_interval_hours * 3600

        last = last_run.get(name)
        if last is None or (now - last).total_seconds() >= interval_secs:
            try:
                handler = _resolve_handler(func_path)
                handler()
                last_run[name] = now
                logger.info('"action": "periodic_task_ran", "task": "%s"', name)
            except Exception:
                logger.exception('"action": "periodic_task_failed", "task": "%s"', name)
                last_run[name] = now  # Don't retry immediately on failure


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": %(message)s}',
    )

    signal.signal(signal.SIGTERM, _handle_signal)
    signal.signal(signal.SIGINT, _handle_signal)

    logger.info('"action": "worker_start"')

    last_periodic_run: dict[str, datetime] = {}

    while not _shutdown:
        now = datetime.now(timezone.utc)

        # Run periodic tasks
        _run_periodic_tasks(last_periodic_run, now)

        # Poll for a job
        db = SessionLocal()
        try:
            job = job_queue.poll(db)
            if job is None:
                db.close()
                time.sleep(POLL_INTERVAL)
                continue

            logger.info(
                '"action": "job_picked", "job_id": %d, "task": "%s", "episode_id": "%s"',
                job.id, job.task, job.episode_id,
            )

            handler_path = TASK_HANDLERS.get(job.task)
            if handler_path is None:
                job_queue.fail(db, job, f"Unknown task: {job.task}")
                continue

            try:
                handler = _resolve_handler(handler_path)
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
