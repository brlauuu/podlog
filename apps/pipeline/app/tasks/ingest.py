"""
Top-level ingestion orchestrator.

ingest_feed   -- poll an RSS feed, enqueue any new episodes
ingest_episode -- run the full pipeline for a single episode
poll_all_feeds -- poll all registered feeds (called periodically)
"""
import logging
import random
from datetime import datetime, timezone

from app.database import SessionLocal
from app.models import Episode, Feed
from app.services import rss as rss_service
from app import job_queue

logger = logging.getLogger(__name__)

# Issue #23: max episodes to process in test mode
TEST_MODE_MAX_EPISODES = 5


def ingest_feed(feed_id: str) -> dict:
    """Poll a registered RSS feed and enqueue any new episodes."""
    db = SessionLocal()
    try:
        feed = db.query(Feed).filter(Feed.id == feed_id).first()
        if not feed:
            logger.error('"action": "ingest_feed_missing", "feed_id": "%s"', feed_id)
            return {"error": "Feed not found"}

        episodes_meta = rss_service.fetch_episodes(feed.url)

        # Filter out episodes that already exist in the DB
        existing_guids = set(
            row[0]
            for row in db.query(Episode.guid).filter(Episode.feed_id == feed_id).all()
        )
        new_episodes_meta = [m for m in episodes_meta if m.guid not in existing_guids]

        # Issue #23: in test mode, limit to TEST_MODE_MAX_EPISODES total episodes
        if feed.mode == "test":
            existing_count = db.query(Episode).filter(Episode.feed_id == feed_id).count()
            remaining_slots = max(0, TEST_MODE_MAX_EPISODES - existing_count)
            if remaining_slots == 0:
                logger.info(
                    '"action": "test_mode_limit_reached", "feed_id": "%s"', feed_id
                )
                feed.last_polled_at = datetime.now(timezone.utc)
                db.commit()
                return {"new_episodes": 0, "reason": "test_mode_limit_reached"}
            if len(new_episodes_meta) > remaining_slots:
                new_episodes_meta = random.sample(new_episodes_meta, remaining_slots)

        new_count = 0
        for meta in new_episodes_meta:
            episode = Episode(
                feed_id=feed_id,
                guid=meta.guid,
                title=meta.title,
                description=meta.description,
                published_at=meta.published_at,
                duration_secs=meta.duration_secs,
                audio_url=meta.audio_url,
                episode_url=meta.episode_url,
                status="pending",
            )
            db.add(episode)
            db.flush()
            db.refresh(episode)

            job_queue.enqueue(db, episode.id, "download")
            new_count += 1

        feed.last_polled_at = datetime.now(timezone.utc)
        db.commit()

        logger.info(
            '"action": "feed_polled", "feed_id": "%s", "new_episodes": %d, "mode": "%s"',
            feed_id,
            new_count,
            feed.mode,
        )
        return {"new_episodes": new_count}
    finally:
        db.close()


def ingest_episode(episode_id: str) -> dict:
    """Re-queue a single episode through the full pipeline (used for manual retry)."""
    db = SessionLocal()
    try:
        job_queue.enqueue(db, episode_id, "download")
        return {"queued": True}
    finally:
        db.close()


def poll_all_feeds() -> dict:
    """Poll all registered feeds for new episodes. Issue #23: skip test feeds."""
    db = SessionLocal()
    try:
        feeds = db.query(Feed).filter(Feed.mode == "full").all()
        for feed in feeds:
            job_queue.enqueue(db, feed.id, "ingest_feed")
        return {"polled": len(feeds)}
    finally:
        db.close()
