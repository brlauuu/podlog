"""Command-style entrypoints for queueing/running pipeline actions.

This module provides a thin boundary between transport handlers (API routes)
and task internals, reducing API coupling to task module details.
"""

from pathlib import Path

from sqlalchemy.orm import Session

from app import job_queue
from app.models import Episode


def enqueue_episode_ingest(db: Session, episode_id: str) -> None:
    """Queue an episode for full pipeline ingestion.

    Manually-uploaded episodes (#650) already have a local file on disk and
    a synthetic ``audio_url`` of the form ``local://<filename>``. Routing
    these through ``download`` would feed the synthetic URL to httpx, whose
    IDNA-encoding of the "host" segment chokes on non-ASCII filenames
    (e.g. ``Invalid IDNA hostname``). For uploads we skip ``download`` and
    start at ``transcribe`` — the pre-fix behavior of the upload route.
    """
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if episode and _is_manual_upload(episode):
        job_queue.enqueue(db, episode_id, "transcribe")
        return
    job_queue.enqueue(db, episode_id, "download")


def _is_manual_upload(episode: Episode) -> bool:
    """A manually-uploaded episode keeps its raw audio in ``audio_local_path``
    on disk and uses a ``local://...`` synthetic ``audio_url``. Either alone
    is suggestive; checking both prevents misclassifying RSS rows that
    happen to have an out-of-band local path set.
    """
    if not episode.audio_local_path:
        return False
    if not Path(episode.audio_local_path).is_file():
        return False
    audio_url = episode.audio_url or ""
    return audio_url.startswith("local://")


def run_chunk_backfill(embed: bool = True) -> dict:
    """Execute chunk backfill once; intended for background thread invocation."""
    from app.tasks.backfill_chunks import backfill_chunks

    return backfill_chunks(embed=embed)
