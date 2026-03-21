"""
Embedding task — generates sentence embeddings for semantic search.

Runs after diarization (segments are finalized). Embeds all segments
for an episode in batch using all-MiniLM-L6-v2, then stores the
384-dim vectors in the segments.embedding column via pgvector.
"""
import logging

from app.database import SessionLocal
from app.models import Segment
from app.tasks.helpers import update_episode
from app import job_queue

logger = logging.getLogger(__name__)


def embed_episode(episode_id: str) -> str:
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
                '"action": "embed_skip_no_segments", "episode_id": "%s"',
                episode_id,
            )
            job_queue.enqueue(db, episode_id, "infer")
            return episode_id

        texts = [seg.text for seg in segments]

        from app.services.embed import embed_texts

        embeddings = embed_texts(texts)

        for seg, emb in zip(segments, embeddings):
            seg.embedding = emb

        db.commit()

        logger.info(
            '"action": "embed_complete", "episode_id": "%s", "segments": %d',
            episode_id,
            len(segments),
        )

        job_queue.enqueue(db, episode_id, "infer")
        return episode_id
    finally:
        db.close()
