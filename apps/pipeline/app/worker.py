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

POLL_INTERVAL = 2  # seconds between queue polls when idle

_shutdown = False


def _handle_signal(signum, frame):
    global _shutdown
    logger.info('"action": "worker_shutdown_requested", "signal": %d', signum)
    _shutdown = True


# Issue #641: exception types raised by transient infrastructure failures
# (network blips, DNS hiccups, momentary connection resets). When a task
# raises one of these, the episode is re-enqueued with exponential
# backoff up to ``retry_max`` attempts.
_TRANSIENT_EXC_TYPES: tuple[type[BaseException], ...] = (
    httpx.NetworkError,
    httpx.TimeoutException,
    socket.gaierror,        # DNS resolution failure
    ConnectionError,        # socket-level connection failures
    TimeoutError,           # also covers socket.timeout (alias since 3.10)
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

# Issue #653: HTTP status codes that download.py historically retried as
# TRANSIENT_NETWORK. Other HTTP errors (4xx) are also retried — but as
# HTTP_ACCESS — preserving download.py's pre-#653 behavior verbatim.
_TRANSIENT_HTTP_STATUS = {429, 500, 502, 503, 504}


def _classify_for_retry(exc: BaseException) -> tuple[bool, str]:
    """Classify an exception as ``(retryable, error_class)``.

    Order matters:

    1. Typed errors carrying ``retryable: bool`` and ``error_class: str``
       attributes (e.g. ``FireworksTranscriptionError``) win — those
       classes know more about their own failure modes than we do here.
    2. ``MemoryError`` is terminal ``OOM``. This used to live in the
       per-task handlers in transcribe.py.
    3. ``httpx.HTTPStatusError`` is retryable for all status codes —
       4xx maps to ``HTTP_ACCESS``, 5xx/429 to ``TRANSIENT_NETWORK``.
       This preserves download.py's historical behavior (#653).
    4. Known transient exception types or message-substring matches
       map to retryable ``TRANSIENT_NETWORK``.
    5. Anything else is terminal ``SYSTEM_ERROR``.
    """
    retryable = getattr(exc, "retryable", None)
    error_class = getattr(exc, "error_class", None)
    if isinstance(retryable, bool):
        if isinstance(error_class, str):
            return (retryable, error_class)
        return (retryable, "TRANSIENT_NETWORK" if retryable else "SYSTEM_ERROR")

    if isinstance(exc, MemoryError):
        return (False, "OOM")

    if isinstance(exc, httpx.HTTPStatusError):
        status = exc.response.status_code
        cls = "TRANSIENT_NETWORK" if status in _TRANSIENT_HTTP_STATUS else "HTTP_ACCESS"
        return (True, cls)

    if isinstance(exc, _TRANSIENT_EXC_TYPES):
        return (True, "TRANSIENT_NETWORK")

    if any(needle in str(exc) for needle in _TRANSIENT_TEXT_NEEDLES):
        return (True, "TRANSIENT_NETWORK")

    return (False, "SYSTEM_ERROR")


def _is_transient(exc: BaseException) -> bool:
    """Backwards-compatible predicate.

    Retained only for ``TestIsTransient`` in ``test_worker.py``; production
    code paths all call ``_classify_for_retry`` directly. If the test cases
    move over, this can go.
    """
    return _classify_for_retry(exc)[0]


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
    transient, error_class = _classify_for_retry(exc)
    episode = db.query(Episode).filter(Episode.id == job.episode_id).first()

    # Episode already terminal (e.g. download.py called mark_failed on
    # DISK_FULL) or row missing entirely: just record the job.
    if episode is None or episode.status == "failed":
        job_queue.fail(db, job, str(exc))
        return

    retry_count = episode.retry_count
    retry_max = episode.retry_max

    if transient and retry_count < retry_max:
        new_count = retry_count + 1
        backoff_secs = settings.retry_backoff_base * (2 ** (new_count - 1))
        update_episode(
            db,
            str(episode.id),
            status="pending",
            retry_count=new_count,
            error_class=error_class,
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
            '"attempt": %d, "retry_max": %d, "backoff_secs": %d, '
            '"error_class": "%s", "error": "%s"',
            str(episode.id), job.task, new_count, retry_max, backoff_secs,
            error_class, exc,
        )
        return

    # Terminal: budget exhausted or non-transient. Mark episode failed
    # (emits notification) and record the job failure.
    suffix = (
        f"Failed after {retry_max} retries: {exc}"
        if transient and retry_count >= retry_max
        else f"Unhandled error in {job.task}: {exc}"
    )
    mark_failed(db, str(episode.id), error_class=error_class, error_message=suffix)
    job_queue.fail(db, job, str(exc))


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
