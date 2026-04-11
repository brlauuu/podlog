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
import importlib
from datetime import datetime, timezone
from typing import Callable

from app.config import settings
from app.database import SessionLocal
from app import job_queue

logger = logging.getLogger(__name__)


def _resolve_handler(dotted_path: str):
    """Resolve 'module.path:function_name' to a callable."""
    module_path, func_name = dotted_path.rsplit(":", 1)
    mod = importlib.import_module(module_path)
    return getattr(mod, func_name)

def _download_handler(episode_id: str) -> None:
    from app.tasks.download import download_episode

    download_episode(episode_id)


def _transcribe_handler(episode_id: str) -> None:
    from app.tasks.transcribe import transcribe_episode

    transcribe_episode(episode_id)


def _diarize_handler(episode_id: str) -> None:
    from app.tasks.diarize import diarize_episode

    diarize_episode(episode_id)


def _chunk_handler(episode_id: str) -> None:
    from app.tasks.chunk import chunk_episode

    chunk_episode(episode_id)


def _embed_handler(episode_id: str) -> None:
    from app.tasks.embed import embed_episode

    embed_episode(episode_id)


def _infer_handler(episode_id: str) -> None:
    from app.tasks.infer import infer_speakers

    infer_speakers(episode_id)


def _archive_handler(episode_id: str) -> None:
    from app.tasks.archive import archive_episode

    archive_episode(episode_id)


# Task name -> handler function (typed callable registry; lazy imports inside wrappers)
TASK_HANDLERS: dict[str, Callable[[str], None]] = {
    "download": _download_handler,
    "transcribe": _transcribe_handler,
    "diarize": _diarize_handler,
    "chunk": _chunk_handler,
    "embed": _embed_handler,
    "infer": _infer_handler,
    "archive": _archive_handler,
}

TASK_HANDLER_TARGETS: dict[str, str] = {
    "download": "app.tasks.download:download_episode",
    "transcribe": "app.tasks.transcribe:transcribe_episode",
    "diarize": "app.tasks.diarize:diarize_episode",
    "chunk": "app.tasks.chunk:chunk_episode",
    "embed": "app.tasks.embed:embed_episode",
    "infer": "app.tasks.infer:infer_speakers",
    "archive": "app.tasks.archive:archive_episode",
}

POLL_INTERVAL = 2  # seconds between queue polls when idle


def _poll_all_feeds() -> None:
    from app.tasks.ingest import poll_all_feeds

    poll_all_feeds()


def _cleanup_zombie_jobs() -> None:
    from app.tasks.cleanup import cleanup_zombie_jobs

    cleanup_zombie_jobs()


def _send_digest() -> None:
    from app.services.digest import send_digest_if_due

    send_digest_if_due()


PERIODIC_TASKS: list[tuple[str, Callable[[], None], int | None]] = [
    # (name, function, interval_seconds)
    ("poll_all_feeds", _poll_all_feeds, None),  # interval set from settings
    ("cleanup_zombie_jobs", _cleanup_zombie_jobs, 30 * 60),
    ("send_digest", _send_digest, 15 * 60),
]

PERIODIC_TASK_TARGETS: dict[str, str] = {
    "poll_all_feeds": "app.tasks.ingest:poll_all_feeds",
    "cleanup_zombie_jobs": "app.tasks.cleanup:cleanup_zombie_jobs",
    "send_digest": "app.services.digest:send_digest_if_due",
}

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info('"action": "worker_shutdown_requested", "signal": %d', signum)
    _shutdown = True


def _validate_worker_wiring() -> None:
    """Validate task/periodic handler references at startup."""
    errors: list[str] = []

    if set(TASK_HANDLERS) != set(TASK_HANDLER_TARGETS):
        errors.append("TASK_HANDLERS and TASK_HANDLER_TARGETS keys differ")

    for task, handler in TASK_HANDLERS.items():
        try:
            if not callable(handler):
                raise TypeError("resolved object is not callable")
            target = TASK_HANDLER_TARGETS[task]
            resolved = _resolve_handler(target)
            if not callable(resolved):
                raise TypeError("import target is not callable")
        except Exception as exc:
            errors.append(
                f'TASK_HANDLERS["{task}"]: {type(exc).__name__}: {exc}'
            )

    periodic_names = {name for name, _, _ in PERIODIC_TASKS}
    if periodic_names != set(PERIODIC_TASK_TARGETS):
        errors.append("PERIODIC_TASKS and PERIODIC_TASK_TARGETS keys differ")

    for name, handler, _ in PERIODIC_TASKS:
        try:
            if not callable(handler):
                raise TypeError("resolved object is not callable")
            target = PERIODIC_TASK_TARGETS[name]
            resolved = _resolve_handler(target)
            if not callable(resolved):
                raise TypeError("import target is not callable")
        except Exception as exc:
            errors.append(
                f'PERIODIC_TASKS["{name}"]: {type(exc).__name__}: {exc}'
            )

    if errors:
        joined = "; ".join(errors)
        raise RuntimeError(f"Invalid worker registry wiring: {joined}")


def _run_periodic_tasks(last_run: dict[str, datetime], now: datetime) -> None:
    """Run any periodic tasks that are due."""
    for name, handler, interval_secs in PERIODIC_TASKS:
        if interval_secs is None:
            interval_secs = settings.feed_poll_interval_hours * 3600

        last = last_run.get(name)
        if last is None or (now - last).total_seconds() >= interval_secs:
            try:
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

    # Register notification handlers
    from app.services.events import bus
    from app.services.digest import register_notification_handlers
    register_notification_handlers(bus)
    _validate_worker_wiring()

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
