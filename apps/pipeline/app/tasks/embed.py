"""
Embedding task — generates sentence embeddings for semantic search.

Runs after chunking. Embeds both raw segments and merged chunks
using all-MiniLM-L6-v2, storing 384-dim vectors via pgvector.
Segment embeddings support existing FTS search; chunk embeddings
support RAG retrieval (issue #114).
"""
import logging

from app.database import SessionLocal
from app.models import Chunk, Segment
from app.tasks.helpers import update_episode
from app import job_queue

logger = logging.getLogger(__name__)


def embed_episode(episode_id: str) -> str:
    db = SessionLocal()
    try:
        update_episode(db, episode_id, status="embedding")

        segments = (
            db.query(Segment)
            .filter(Segment.episode_id == episode_id)
            .order_by(Segment.start_time)
            .all()
        )

        if not segments:
            logger.warning(
                '"action": "embed_skip_no_segments", "episode_id": "%s"',
                episode_id,
            )
            job_queue.enqueue(db, episode_id, "infer")
            return episode_id

        from app.services.embed import embed_texts

        # Embed raw segments (backward compat with existing search)
        seg_texts = [seg.text for seg in segments]
        seg_embeddings = embed_texts(seg_texts)
        for seg, emb in zip(segments, seg_embeddings):
            seg.embedding = emb

        # Embed chunks (for RAG retrieval)
        chunks = (
            db.query(Chunk)
            .filter(Chunk.episode_id == episode_id)
            .order_by(Chunk.start_time)
            .all()
        )
        if chunks:
            chunk_texts = [c.text for c in chunks]
            chunk_embeddings = embed_texts(chunk_texts)
            for chunk, emb in zip(chunks, chunk_embeddings):
                chunk.embedding = emb

        db.commit()

        logger.info(
            '"action": "embed_complete", "episode_id": "%s", "segments": %d, "chunks": %d',
            episode_id,
            len(segments),
            len(chunks),
        )

        job_queue.enqueue(db, episode_id, "infer")
        return episode_id
    finally:
        db.close()
