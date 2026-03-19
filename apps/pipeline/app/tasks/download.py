"""
Episode download task -- PRD-01 S5.2

Handles:
- GAP-06: disk space pre-check before starting download
- Auto-retry on transient failures (TRANSIENT_NETWORK, HTTP_ACCESS) up to retry_max
- Immediate failure for non-transient errors (DISK_FULL, OOM, SYSTEM_ERROR)
"""
import logging
import shutil
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx
from app.config import settings
from app.database import SessionLocal
from app.models import Episode
from app.tasks.helpers import update_episode as _update_episode
from app import job_queue

logger = logging.getLogger(__name__)

# HTTP status codes that are considered transient (worth retrying)
TRANSIENT_HTTP_CODES = {500, 502, 503, 504}


def _classify_http_error(status_code: int) -> str:
    return "TRANSIENT_NETWORK" if status_code in TRANSIENT_HTTP_CODES else "HTTP_ACCESS"


def download_episode(episode_id: str) -> str:
    """Download audio for an episode. Returns the local file path on success."""
    db = SessionLocal()
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            raise RuntimeError(f"Episode {episode_id} not found")

        _update_episode(db, episode_id, status="downloading")

        # GAP-06: pre-check disk space before downloading
        try:
            usage = shutil.disk_usage(settings.data_dir)
            if usage.free < settings.disk_headroom_bytes:
                needed_gb = settings.disk_headroom_bytes / 1024**3
                _update_episode(
                    db,
                    episode_id,
                    status="failed",
                    error_class="DISK_FULL",
                    error_message=(
                        f"Insufficient disk space. Need {needed_gb:.1f} GB free before download."
                    ),
                )
                logger.error(
                    '"action": "disk_full_precheck", "episode_id": "%s", '
                    '"free_bytes": %d, "required_bytes": %d',
                    episode_id,
                    usage.free,
                    settings.disk_headroom_bytes,
                )
                return episode_id  # Terminal failure -- no retry
        except OSError as exc:
            logger.warning("Disk check failed (non-fatal): %s", exc)

        raw_dir = Path(settings.audio_raw_dir)
        raw_dir.mkdir(parents=True, exist_ok=True)

        # Derive a safe filename from the URL
        url_path = episode.audio_url.split("?")[0].rstrip("/")
        suffix = Path(url_path).suffix or ".mp3"
        dest = raw_dir / f"{episode_id}{suffix}"

        retry_count = episode.retry_count

        try:
            _download_file(episode.audio_url, dest, episode_id, db)
        except httpx.TimeoutException as exc:
            _handle_transient_failure(
                db, episode_id, episode.retry_max, retry_count, "TRANSIENT_NETWORK", str(exc)
            )
            return episode_id
        except httpx.HTTPStatusError as exc:
            error_class = _classify_http_error(exc.response.status_code)
            _handle_transient_failure(
                db,
                episode_id,
                episode.retry_max,
                retry_count,
                error_class,
                f"HTTP {exc.response.status_code}",
            )
            return episode_id
        except OSError as exc:
            if "No space left on device" in str(exc) or getattr(exc, "errno", None) == 28:
                _update_episode(
                    db,
                    episode_id,
                    status="failed",
                    error_class="DISK_FULL",
                    error_message="Disk full during download. Free space and retry.",
                )
                return episode_id

            _update_episode(
                db,
                episode_id,
                status="failed",
                error_class="SYSTEM_ERROR",
                error_message=str(exc),
            )
            return episode_id
        except Exception as exc:
            _update_episode(
                db,
                episode_id,
                status="failed",
                error_class="SYSTEM_ERROR",
                error_message=str(exc),
            )
            logger.exception('"action": "download_failed", "episode_id": "%s"', episode_id)
            return episode_id

        _update_episode(db, episode_id, audio_local_path=str(dest))

        # Hand off to transcription via job queue
        job_queue.enqueue(db, episode_id, "transcribe")
        return episode_id
    finally:
        db.close()


def _download_file(url: str, dest: Path, episode_id: str, db) -> None:
    """Stream download with progress updates."""
    with httpx.stream("GET", url, follow_redirects=True, timeout=60.0) as resp:
        resp.raise_for_status()
        total = int(resp.headers.get("content-length", 0))
        downloaded = 0

        with open(dest, "wb") as fh:
            for chunk in resp.iter_bytes(chunk_size=65536):
                fh.write(chunk)
                downloaded += len(chunk)
                if total > 0:
                    pct = int(downloaded * 100 / total)
                    db.query(Episode).filter(Episode.id == episode_id).update(
                        {"status": f"downloading:{pct}", "updated_at": datetime.now(timezone.utc)}
                    )
                    # Don't commit every chunk -- commit in batches
                    if pct % 10 == 0:
                        db.commit()

        db.commit()
        logger.info(
            '"action": "download_complete", "episode_id": "%s", "bytes": %d',
            episode_id,
            downloaded,
        )


def _handle_transient_failure(
    db, episode_id: str, retry_max: int, retry_count: int, error_class: str, error_msg: str
) -> None:
    """
    Increment retry count. If under retry_max, re-enqueue with exponential backoff.
    If at max, mark permanently failed.
    """
    new_count = retry_count + 1

    if new_count <= retry_max:
        backoff = settings.retry_backoff_base * (2 ** (new_count - 1))
        _update_episode(
            db,
            episode_id,
            status="pending",
            retry_count=new_count,
            error_class=error_class,
            error_message=f"Retrying ({new_count}/{retry_max}) -- {error_msg}. Next in {backoff}s",
        )
        logger.warning(
            '"action": "transient_failure_retry", "episode_id": "%s", '
            '"attempt": %d, "backoff_secs": %d, "error": "%s"',
            episode_id,
            new_count,
            backoff,
            error_msg,
        )
        retry_at = datetime.now(timezone.utc) + timedelta(seconds=backoff)
        job_queue.enqueue(db, episode_id, "download", retry_at=retry_at)
    else:
        _update_episode(
            db,
            episode_id,
            status="failed",
            retry_count=new_count,
            error_class=error_class,
            error_message=f"Failed after {retry_max} retries: {error_msg}",
        )
        logger.error(
            '"action": "permanent_failure", "episode_id": "%s", "error_class": "%s"',
            episode_id,
            error_class,
        )
