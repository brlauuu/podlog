"""
Episode download task -- PRD-01 S5.2

Handles:
- GAP-06: disk space pre-check before starting download
- Disk-full mid-download: immediate ``DISK_FULL`` terminal failure
- Manual-upload audio missing: ``MANUAL_UPLOAD_FILE_MISSING`` terminal (#650)

Other failures (network, HTTP errors, OS errors) propagate to the worker
loop, which classifies them and decides retry vs terminal (#641 / #653).
"""
import logging
import shutil
from datetime import datetime, timezone
from pathlib import Path

import httpx
from app.config import settings
from app.database import SessionLocal
from app.models import Episode
from app.tasks.helpers import mark_failed, update_episode as _update_episode
from app import job_queue

logger = logging.getLogger(__name__)


def download_episode(episode_id: str) -> str:
    """Download audio for an episode. Returns the local file path on success.

    Terminal-failure cases are handled here (DISK_FULL, MANUAL_UPLOAD_FILE_MISSING)
    so we can supply specific error classes and messages. Anything else is
    raised — the worker classifies and retries.
    """
    db = SessionLocal()
    try:
        episode = db.query(Episode).filter(Episode.id == episode_id).first()
        if not episode:
            raise RuntimeError(f"Episode {episode_id} not found")

        # #650: manual-upload episodes have a synthetic ``local://<filename>``
        # URL. ``enqueue_episode_ingest`` normally routes them straight to
        # ``transcribe``, but that check requires the on-disk file to still
        # be present. If the raw audio is gone (host reboot wiped /data,
        # manual purge, restored DB without audio, etc.) we'd fall through
        # to a download attempt — httpx raises ``UnsupportedProtocol`` (or
        # ``InvalidURL`` on non-ASCII filenames) which is unhelpful to a
        # user trying to figure out why retry isn't working. Surface a
        # dedicated terminal error instead.
        if (episode.audio_url or "").startswith("local://"):
            mark_failed(
                db,
                episode_id,
                error_class="MANUAL_UPLOAD_FILE_MISSING",
                error_message=(
                    "Manual-upload audio file is missing on disk. "
                    "Re-upload the file and retry."
                ),
            )
            return episode_id

        _update_episode(db, episode_id, status="downloading")

        # GAP-06: pre-check disk space before downloading
        try:
            usage = shutil.disk_usage(settings.data_dir)
            if usage.free < settings.disk_headroom_bytes:
                needed_gb = settings.disk_headroom_bytes / 1024**3
                mark_failed(
                    db,
                    episode_id,
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

        try:
            _download_file(episode.audio_url, dest, episode_id, db)
        except OSError as exc:
            # Disk-full mid-download is terminal (no point retrying without
            # operator intervention). Re-raise everything else to the worker.
            if "No space left on device" in str(exc) or getattr(exc, "errno", None) == 28:
                mark_failed(
                    db,
                    episode_id,
                    error_class="DISK_FULL",
                    error_message="Disk full during download. Free space and retry.",
                )
                return episode_id
            raise

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
