"""
DB-backed worker — replaces Celery worker.

Polls the job_queue table in a loop and dispatches to task handlers.
Also runs periodic tasks (feed polling, zombie cleanup) on a schedule.

Usage:
  python -m app.worker
"""
import logging
import signal
import socket
import time
from datetime import datetime, timedelta, timezone

import httpx

from app.database import SessionLocal
from app import job_queue
from app.config import settings
from app.models import Episode
from app.services.meta_analysis import is_stale, recompute_and_store
from app.task_registry import (
    TASK_HANDLERS,
    PERIODIC_TASKS,
    validate_wiring,
)
from app.tasks.helpers import mark_failed, update_episode

logger = logging.getLogger(__name__)


# Issue #641: exception types raised by transient infrastructure failures
# (network blips, DNS hiccups, momentary connection resets). When a task
# task raises one of these, the episode is re-enqueued with exponential
# backoff up to ``retry_max`` attempts. Anything else is treated as
# terminal SYSTEM_ERROR.
_TRANSIENT_EXC_TYPES: tuple[type[BaseException], ...] = (
    httpx.NetworkError,
    httpx.TimeoutException,
    socket.gaierror,        # DNS resolution failure
    socket.timeout,
    ConnectionError,        # socket-level connection failures
    TimeoutError,
)

# Substrings that indicate a transient failure even when the exception
# type itself is generic (e.g. plain `OSError("Network is unreachable")`
# rather than a typed httpx error). Keep this conservative — false
# positives just delay terminal failure by retry_max attempts; false
# negatives strand episodes again.
_TRANSIENT_TEXT_NEEDLES = (
    "Network is unreachable",
    "Temporary failure in name resolution",
    "Connection reset by peer",
    "Connection refused",
    "EOF occurred in violation of protocol",
)


def _is_transient(exc: BaseException) -> bool:
    """Classify an exception as a transient infrastructure failure."""
    if isinstance(exc, _TRANSIENT_EXC_TYPES):
        return True
    msg = str(exc)
    return any(needle in msg for needle in _TRANSIENT_TEXT_NEEDLES)


def _handle_task_exception(db, job, exc: Exception) -> None:
    """Decide whether to retry the failing task or mark it terminal.

    On transient errors with retry budget remaining, the episode is reset
    to ``pending`` (so it doesn't strand in a mid-pipeline status like
    ``embedding``) and a fresh job for the same task is enqueued with
    exponential backoff. Otherwise the episode is marked failed and the
    standard failure notification fires via ``mark_failed``.

    The current job is always marked failed in job_queue — that's the
    historical record of this attempt. The retry (if any) is a separate
    new row.
    """
    transient = _is_transient(exc)
    episode = db.query(Episode).filter(Episode.id == job.episode_id).first()

    # Episode already terminal (e.g. download.py called mark_failed on
    # DISK_FULL): respect the task's decision and just record the job.
    if episode is None or episode.status == "failed":
        job_queue.fail(db, job, str(exc))
        return

    retry_count = int(getattr(episode, "retry_count", 0) or 0)
    retry_max = int(getattr(episode, "retry_max", settings.retry_max) or settings.retry_max)

    if transient and retry_count < retry_max:
        new_count = retry_count + 1
        backoff_secs = settings.retry_backoff_base * (2 ** (new_count - 1))
        update_episode(
            db,
            str(episode.id),
            status="pending",
            retry_count=new_count,
            error_class="TRANSIENT_NETWORK",
            error_message=(
                f"Transient error in {job.task} (attempt {new_count}/{retry_max}): "
                f"{exc}. Next retry in {backoff_secs}s."
            ),
        )
        retry_at = datetime.now(timezone.utc) + timedelta(seconds=backoff_secs)
        job_queue.enqueue(db, str(episode.id), job.task, retry_at=retry_at)
        job_queue.fail(db, job, str(exc))
        logger.warning(
            '"action": "task_transient_retry", "episode_id": "%s", "task": "%s", '
            '"attempt": %d, "retry_max": %d, "backoff_secs": %d, "error": "%s"',
            episode.id, job.task, new_count, retry_max, backoff_secs, exc,
        )
        return

    # Terminal: budget exhausted or non-transient. Mark episode failed
    # (emits notification) and record the job failure.
    error_class = "TRANSIENT_NETWORK" if transient else "SYSTEM_ERROR"
    suffix = (
        f"Failed after {retry_max} retries: {exc}"
        if transient and retry_count >= retry_max
        else f"Unhandled error in {job.task}: {exc}"
    )
    mark_failed(db, str(episode.id), error_class=error_class, error_message=suffix)
    job_queue.fail(db, job, str(exc))

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
                # Issue #641: classify and either retry transient errors
                # or mark terminal. Tasks that handle their own exceptions
                # (download, transcribe) catch and convert to a normal
                # return, so this branch never fires for them — the
                # generic retry path is dormant when per-task retry exists.
                _handle_task_exception(db, job, exc)
        except Exception:
            logger.exception('"action": "worker_loop_error"')
        finally:
            db.close()

    logger.info('"action": "worker_stopped"')


if __name__ == "__main__":
    main()
