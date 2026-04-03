"""
Chunking task — merges segments into speaker-turn chunks for RAG retrieval.

Runs after diarization (segments are finalized with speaker labels).
Creates chunks in the chunks table, then enqueues the embed step.
"""
import logging

from app.database import SessionLocal
from app.models import Chunk, Segment
from app.services.chunking import merge_segments_into_chunks
from app import job_queue

logger = logging.getLogger(__name__)


def chunk_episode(episode_id: str) -> str:
    db = SessionLocal()
    try:
        segments = (
            db.query(Segment)
            .filter(Segment.episode_id == episode_id)
            .order_by(Segment.start_time)
            .all()
        )

        if not segments:
            logger.warning(
                '"action": "chunk_skip_no_segments", "episode_id": "%s"',
                episode_id,
            )
            job_queue.enqueue(db, episode_id, "embed")
            return episode_id

        # Delete any existing chunks for this episode (idempotent)
        db.query(Chunk).filter(Chunk.episode_id == episode_id).delete()

        seg_dicts = [
            {
                "id": seg.id,
                "episode_id": seg.episode_id,
                "speaker_label": seg.speaker_label,
                "start_time": seg.start_time,
                "end_time": seg.end_time,
                "text": seg.text,
            }
            for seg in segments
        ]

        chunks = merge_segments_into_chunks(seg_dicts)

        for chunk in chunks:
            db.add(
                Chunk(
                    episode_id=episode_id,
                    speaker_label=chunk["speaker_label"],
                    start_time=chunk["start_time"],
                    end_time=chunk["end_time"],
                    text=chunk["text"],
                    segment_ids=chunk["segment_ids"],
                )
            )

        db.commit()

        logger.info(
            '"action": "chunk_complete", "episode_id": "%s", "segments": %d, "chunks": %d',
            episode_id,
            len(segments),
            len(chunks),
        )

        job_queue.enqueue(db, episode_id, "embed")
        return episode_id
    finally:
        db.close()
