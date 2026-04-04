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

# Progress tracking — read by the /api/backfill/status endpoint.
progress: dict = {}


def backfill_chunks(embed: bool = True) -> dict:
    """Chunk (and optionally embed) all done episodes that have segments.

    When embed=True, this also backfills segment embeddings for any
    segments with embedding IS NULL, not just chunks.

    Args:
        embed: If True, also generate embeddings for chunks and segments.

    Returns:
        Summary dict with counts.
    """
    global progress

    if embed:
        from app.services.embed import embed_texts

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
        total_segments_embedded = 0

        progress = {
            "episodes_total": total,
            "episodes_done": 0,
            "chunks_created": 0,
            "segments_embedded": 0,
        }

        logger.info('"action": "backfill_start", "episodes": %d', total)

        for i, ep in enumerate(episodes, 1):
            segments = (
                db.query(Segment)
                .filter(Segment.episode_id == ep.id)
                .order_by(Segment.start_time)
                .all()
            )

            if not segments:
                skipped += 1
                progress["episodes_done"] = i
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

            if embed:
                # Embed chunks
                if chunk_objs:
                    texts = [c.text for c in chunk_objs]
                    embeddings = embed_texts(texts)
                    for obj, emb in zip(chunk_objs, embeddings):
                        obj.embedding = emb

                # Embed segments missing embeddings
                segs_missing = [s for s in segments if s.embedding is None]
                if segs_missing:
                    seg_texts = [s.text for s in segs_missing]
                    seg_embeddings = embed_texts(seg_texts)
                    for seg, emb in zip(segs_missing, seg_embeddings):
                        seg.embedding = emb
                    total_segments_embedded += len(segs_missing)

            db.commit()

            chunked += 1
            total_chunks += len(chunks)

            progress["episodes_done"] = i
            progress["chunks_created"] = total_chunks
            progress["segments_embedded"] = total_segments_embedded

            if i % 10 == 0 or i == total:
                logger.info(
                    '"action": "backfill_progress", "done": %d, "total": %d, '
                    '"chunks": %d, "segments_embedded": %d',
                    i, total, total_chunks, total_segments_embedded,
                )

        summary = {
            "episodes_total": total,
            "episodes_chunked": chunked,
            "episodes_skipped": skipped,
            "chunks_created": total_chunks,
            "segments_embedded": total_segments_embedded,
        }
        logger.info('"action": "backfill_complete", "summary": %s', summary)
        return summary
    finally:
        progress = {}
        db.close()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format='{"time": "%(asctime)s", "level": "%(levelname)s", "logger": "%(name)s", "message": %(message)s}',
    )
    result = backfill_chunks(embed=True)
    print(f"Backfill complete: {result}")
