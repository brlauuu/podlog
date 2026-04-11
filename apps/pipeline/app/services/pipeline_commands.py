"""Command-style entrypoints for queueing/running pipeline actions.

This module provides a thin boundary between transport handlers (API routes)
and task internals, reducing API coupling to task module details.
"""

from sqlalchemy.orm import Session

from app import job_queue


def enqueue_episode_ingest(db: Session, episode_id: str) -> None:
    """Queue an episode for full pipeline ingestion (starts at download)."""
    job_queue.enqueue(db, episode_id, "download")


def run_chunk_backfill(embed: bool = True) -> dict:
    """Execute chunk backfill once; intended for background thread invocation."""
    from app.tasks.backfill_chunks import backfill_chunks

    return backfill_chunks(embed=embed)
