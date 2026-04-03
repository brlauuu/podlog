"""
One-time backfill: chunk and embed all existing done episodes.

Idempotent — deletes existing chunks for each episode before recreating.
Can be run via the /api/backfill/chunks endpoint or as a standalone script.

Usage:
  python -m app.tasks.backfill_chunks
"""
import logging

from app.database import SessionLocal
from app.models import Chunk, Episode, Segment
from app.services.chunking import merge_segments_into_chunks

logger = logging.getLogger(__name__)


def backfill_chunks(embed: bool = True) -> dict:
    """Chunk (and optionally embed) all done episodes that have segments.

    Args:
        embed: If True, also generate embeddings for the new chunks.

    Returns:
        Summary dict with counts.
    """
    db = SessionLocal()
    try:
        episodes = (
            db.query(Episode)
            .filter(Episode.status == "done")
            .order_by(Episode.processed_at)
            .all()
        )

        total = len(episodes)
        chunked = 0
        skipped = 0
        total_chunks = 0

        logger.info('"action": "backfill_chunks_start", "episodes": %d', total)

        for i, ep in enumerate(episodes, 1):
            segments = (
                db.query(Segment)
                .filter(Segment.episode_id == ep.id)
                .order_by(Segment.start_time)
                .all()
            )

            if not segments:
                skipped += 1
                continue

            # Delete existing chunks (idempotent)
            db.query(Chunk).filter(Chunk.episode_id == ep.id).delete()

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

            chunk_objs = []
            for chunk in chunks:
                obj = Chunk(
                    episode_id=ep.id,
                    speaker_label=chunk["speaker_label"],
                    start_time=chunk["start_time"],
                    end_time=chunk["end_time"],
                    text=chunk["text"],
                    segment_ids=chunk["segment_ids"],
                )
                db.add(obj)
                chunk_objs.append(obj)

            db.flush()

            # Embed the chunks
            if embed and chunk_objs:
                from app.services.embed import embed_texts

                texts = [c.text for c in chunk_objs]
                embeddings = embed_texts(texts)
                for obj, emb in zip(chunk_objs, embeddings):
                    obj.embedding = emb

            db.commit()

            chunked += 1
            total_chunks += len(chunks)

            if i % 10 == 0 or i == total:
                logger.info(
                    '"action": "backfill_chunks_progress", "done": %d, "total": %d',
                    i, total,
                )

        summary = {
            "episodes_total": total,
            "episodes_chunked": chunked,
            "episodes_skipped": skipped,
            "chunks_created": total_chunks,
        }
        logger.info('"action": "backfill_chunks_complete", "summary": %s', summary)
        return summary
    finally:
        db.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": %(message)s}',
    )
    result = backfill_chunks(embed=True)
    print(f"Backfill complete: {result}")
