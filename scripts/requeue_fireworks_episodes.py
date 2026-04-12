#!/usr/bin/env python3
"""
One-off script: re-queue Fireworks-processed episodes for re-diarization.

Issue #349: the Fireworks diarize path previously produced coarse segments
(minutes long) instead of sentence-level segments. All episodes processed
via Fireworks need to re-run so the fixed rebuild_segments_from_words()
path produces proper granularity.

- Episodes whose audio file exists on disk: queued at 'transcribe'
- Episodes whose audio file is missing: queued at 'download' to re-fetch

Downstream stages run automatically as each stage completes.

Usage (run inside the pipeline container or with pipeline venv active):
    python scripts/requeue_fireworks_episodes.py [--dry-run]
"""
import argparse
import logging
import sys
from pathlib import Path

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    stream=sys.stdout,
)
logger = logging.getLogger(__name__)


def main(dry_run: bool) -> None:
    from app.database import SessionLocal
    from app.models import Episode, Job
    from app import job_queue

    db = SessionLocal()
    try:
        episodes = (
            db.query(Episode)
            .filter(
                Episode.inference_provider_used == "fireworks",
                Episode.status.in_(["done", "failed"]),
            )
            .order_by(Episode.updated_at.asc())
            .all()
        )

        if not episodes:
            logger.info("No Fireworks episodes found — nothing to do.")
            return

        logger.info("Found %d Fireworks-processed episode(s) to evaluate.", len(episodes))

        has_audio = []
        needs_download = []
        skipped = []

        for ep in episodes:
            if not ep.audio_local_path:
                skipped.append(ep)
                continue
            if Path(ep.audio_local_path).exists():
                has_audio.append(ep)
            else:
                needs_download.append(ep)

        logger.info(
            "  Audio on disk: %d (→ transcribe), Missing audio: %d (→ download), "
            "No path recorded: %d (skip)",
            len(has_audio), len(needs_download), len(skipped),
        )

        if dry_run:
            logger.info("DRY RUN — no changes will be made.")
            for ep in has_audio:
                logger.info("  [transcribe] %s  %r", ep.id, ep.title)
            for ep in needs_download:
                logger.info("  [download]   %s  %r", ep.id, ep.title)
            for ep in skipped:
                logger.info("  [skip]       %s  %r", ep.id, ep.title)
            return

        queued_transcribe = 0
        queued_download = 0

        for ep, task in [(e, "transcribe") for e in has_audio] + \
                        [(e, "download") for e in needs_download]:
            # Cancel any stale pending/picked jobs so we don't double-process.
            cancelled = (
                db.query(Job)
                .filter(
                    Job.episode_id == str(ep.id),
                    Job.status.in_(["pending", "picked"]),
                )
                .all()
            )
            for job in cancelled:
                job.status = "failed"
                job.error = "cancelled by requeue_fireworks_episodes script (#349 fix)"
            if cancelled:
                logger.info(
                    "  cancelled %d existing job(s) for episode %s", len(cancelled), ep.id
                )

            # Reset episode state.
            ep.status = "pending"
            ep.error_message = None
            ep.error_class = None
            ep.diarization_error = None
            ep.has_diarization = False
            ep.transcribe_duration_secs = None
            ep.diarize_duration_secs = None

            db.flush()

            job_queue.enqueue(db, str(ep.id), task)
            logger.info("  queued [%s]: %s  %r", task, ep.id, ep.title)
            if task == "transcribe":
                queued_transcribe += 1
            else:
                queued_download += 1

        db.commit()
        logger.info(
            "Done. Queued at transcribe: %d, Queued at download: %d, Skipped: %d.",
            queued_transcribe, queued_download, len(skipped),
        )

    finally:
        db.close()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be done without making any changes.",
    )
    args = parser.parse_args()
    main(dry_run=args.dry_run)
