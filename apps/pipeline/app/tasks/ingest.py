"""
Top-level ingestion orchestrator.

ingest_feed   — poll an RSS feed, enqueue any new episodes
ingest_episode — run the full pipeline for a single episode
"""
import logging
from datetime import datetime, timezone

from celery import shared_task

from app.database import SessionLocal
from app.models import Episode, Feed
from app.services import rss as rss_service

logger = logging.getLogger(__name__)


@shared_task(bind=True, name="ingest_feed")
def ingest_feed(self, feed_id: str) -> dict:
    """Poll a registered RSS feed and enqueue any new episodes."""
    from app.tasks.download import download_episode

    db = SessionLocal()
    try:
        feed = db.query(Feed).filter(Feed.id == feed_id).first()
        if not feed:
            logger.error('"action": "ingest_feed_missing", "feed_id": "%s"', feed_id)
            return {"error": "Feed not found"}

        episodes_meta = rss_service.fetch_episodes(feed.url)
        new_count = 0

        for meta in episodes_meta:
            existing = (
                db.query(Episode)
                .filter(Episode.feed_id == feed_id, Episode.guid == meta.guid)
                .first()
            )
            if existing:
                continue

            episode = Episode(
                feed_id=feed_id,
                guid=meta.guid,
                title=meta.title,
                description=meta.description,
                published_at=meta.published_at,
                duration_secs=meta.duration_secs,
                audio_url=meta.audio_url,
                status="pending",
            )
            db.add(episode)
            db.flush()
            db.refresh(episode)

            result = download_episode.delay(episode.id)
            episode.celery_task_id = result.id
            new_count += 1

        feed.last_polled_at = datetime.now(timezone.utc)
        db.commit()

        logger.info(
            '"action": "feed_polled", "feed_id": "%s", "new_episodes": %d',
            feed_id,
            new_count,
        )
        return {"new_episodes": new_count}
    finally:
        db.close()


@shared_task(bind=True, name="ingest_episode")
def ingest_episode(self, episode_id: str) -> dict:
    """Re-queue a single episode through the full pipeline (used for manual retry)."""
    from app.tasks.download import download_episode

    result = download_episode.delay(episode_id)
    return {"task_id": result.id}
