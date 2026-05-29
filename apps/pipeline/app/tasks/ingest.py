"""
Top-level ingestion orchestrator.

ingest_feed   -- poll an RSS feed, enqueue any new episodes
poll_all_feeds -- poll all registered feeds (called periodically)
"""
import logging
from datetime import datetime, timezone
from typing import Optional

from app.database import SessionLocal
from app.models import Episode, Feed
from app.services import rss as rss_service
from app import job_queue

logger = logging.getLogger(__name__)

# Issue #23: max episodes to process in test mode (default 1 — most recent)
# Issue #84: changed from random 5 to most-recent 1
TEST_MODE_MAX_EPISODES = 1


def ingest_feed(feed_id: str, selected_guids: Optional[list[str]] = None) -> dict:
    """
    Poll a registered RSS feed and enqueue any new episodes.

    selected_guids: when feed.mode == "selective", only episodes whose GUIDs
    are in this list are ingested. GUIDs are validated against the live feed
    to prevent injection (issue #84).
    """
    db = SessionLocal()
    try:
        feed = db.query(Feed).filter(Feed.id == feed_id).first()
        if not feed:
            logger.error('"action": "ingest_feed_missing", "feed_id": "%s"', feed_id)
            return {"error": "Feed not found"}

        # Issue #743: paused feeds skip ingestion entirely. Already-processed
        # episodes are untouched; on unpause the next poll picks up the gap.
        if feed.paused:
            logger.info('"action": "paused_feed_skipped", "feed_id": "%s"', feed_id)
            return {"new_episodes": 0, "reason": "feed_paused"}

        # Issue #84: selective feeds are never auto-polled for new episodes —
        # skip re-fetching episodes on periodic polls (selected_guids is None then)
        if feed.mode == "selective" and selected_guids is None:
            logger.info(
                '"action": "selective_feed_skipped", "feed_id": "%s"', feed_id
            )
            return {"new_episodes": 0, "reason": "selective_mode_no_new_episodes"}

        # Single HTTP fetch gets both feed-level metadata (refreshed for
        # PRD-04 B1 person tags) and episode entries.
        preview = rss_service.fetch_feed_and_episodes(feed.url)
        episodes_meta = preview.episodes

        # Refresh RSS-derived person tags on each poll. When the publisher
        # replaces the tag with a new value we overwrite; when the tag is
        # absent from the new XML we keep the last-known-good value rather
        # than clearing it (publishers sometimes strip these temporarily
        # during site migrations). Title/description are intentionally not
        # refreshed here to preserve existing set-once behavior.
        if preview.feed.itunes_author is not None:
            feed.itunes_author = preview.feed.itunes_author
        if preview.feed.itunes_owner_name is not None:
            feed.itunes_owner_name = preview.feed.itunes_owner_name
        # PRD-04 B2: refresh <podcast:person> tags. Empty list means the
        # publisher dropped all tags on this poll — treat same as other
        # person fields and preserve the last-known value rather than
        # clearing it. Absence of tags has never been a positive signal.
        if preview.feed.podcast_persons:
            feed.podcast_persons = preview.feed.podcast_persons

        # Issue #84: in selective mode, restrict to the caller-supplied GUIDs.
        # Validate each requested GUID is present in the live feed to prevent injection.
        if feed.mode == "selective" and selected_guids is not None:
            live_guids = {ep.guid for ep in episodes_meta}
            invalid = [g for g in selected_guids if g not in live_guids]
            if invalid:
                logger.error(
                    '"action": "selective_invalid_guids", "feed_id": "%s", "invalid": %s',
                    feed_id, invalid,
                )
                return {"error": "selected_guids contains GUIDs not present in feed"}
            episodes_meta = [ep for ep in episodes_meta if ep.guid in set(selected_guids)]

        # Filter out episodes that already exist in the DB
        existing_guids = set(
            row[0]
            for row in db.query(Episode.guid).filter(Episode.feed_id == feed_id).all()
        )
        new_episodes_meta = [m for m in episodes_meta if m.guid not in existing_guids]

        # Issue #23 / #84: in test mode, limit to TEST_MODE_MAX_EPISODES most-recent episodes.
        # Use most-recent (head of list, feedparser returns newest-first) rather than random
        # so results are deterministic and predictable.
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
            new_episodes_meta = new_episodes_meta[:remaining_slots]

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
                episode_author=meta.episode_author,
                podcast_persons=meta.podcast_persons or None,
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


def poll_all_feeds() -> dict:
    """Poll all registered feeds for new episodes. Skip test and selective feeds."""
    db = SessionLocal()
    try:
        # Issue #23: skip test feeds; #84: skip selective; #743: skip paused
        feeds = db.query(Feed).filter(Feed.mode == "full", Feed.paused.is_(False)).all()
        results = []
        for feed in feeds:
            try:
                result = ingest_feed(feed.id)
                results.append(result)
            except Exception:
                logger.exception('"action": "poll_feed_failed", "feed_id": "%s"', feed.id)
        return {"polled": len(feeds)}
    finally:
        db.close()
