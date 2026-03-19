"""
Feed management API -- PRD-01 S10, Issue #23

POST   /api/feeds         Add a new RSS feed (with validation -- GAP-02)
GET    /api/feeds         List all feeds
DELETE /api/feeds/{id}    Remove a feed (optionally delete episodes)
POST   /api/feeds/{id}/poll  Trigger immediate re-poll
"""
import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Feed
from app.services import rss as rss_service
from app.tasks.ingest import ingest_feed as _ingest_feed

logger = logging.getLogger(__name__)
router = APIRouter()


class AddFeedRequest(BaseModel):
    url: str
    mode: Literal["test", "full"] = "full"


class FeedResponse(BaseModel):
    id: str
    url: str
    title: Optional[str]
    description: Optional[str]
    image_url: Optional[str]
    website_url: Optional[str]
    mode: str
    last_polled_at: Optional[datetime]
    created_at: datetime

    model_config = {"from_attributes": True}


@router.post("/feeds", response_model=FeedResponse, status_code=201)
def add_feed(body: AddFeedRequest, db: Session = Depends(get_db)) -> FeedResponse:
    """
    Add a new RSS feed. Validates the URL is a parseable RSS/Atom feed (GAP-02)
    before persisting. Enqueues ingestion of all existing episodes.

    Issue #23: If a feed already exists in test mode and is re-added, it gets
    promoted to full mode and remaining episodes are ingested.
    """
    # Check for existing feed first -- handle test->full promotion
    existing = db.query(Feed).filter(Feed.url == body.url).first()
    if existing:
        if existing.mode == "test" and body.mode == "full":
            # Promote test -> full: flip mode and re-ingest to pick up remaining episodes
            existing.mode = "full"
            db.commit()
            db.refresh(existing)
            try:
                _ingest_feed(existing.id)
            except Exception as exc:
                logger.error(
                    '"action": "promote_feed_dispatch_failed", "feed_id": "%s", "error": "%s"',
                    existing.id, exc,
                )
            logger.info(
                '"action": "feed_promoted", "feed_id": "%s", "url": "%s"',
                existing.id, body.url,
            )
            return FeedResponse.model_validate(existing)
        raise HTTPException(status_code=409, detail="Feed already registered")

    # GAP-02: validate the feed is parseable before storing
    try:
        feed_meta = rss_service.validate_and_parse_feed(body.url)
    except rss_service.InvalidFeedError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    feed = Feed(
        url=body.url,
        title=feed_meta.title,
        description=feed_meta.description,
        image_url=feed_meta.image_url,
        website_url=feed_meta.website_url,
        mode=body.mode,
    )
    db.add(feed)
    db.flush()  # Assign ID without committing, so we can roll back on dispatch failure

    # Trigger ingestion (creates download jobs for each episode)
    try:
        _ingest_feed(feed.id)
    except Exception as exc:
        # Feed is saved but ingestion failed — not fatal, can be re-polled
        logger.error('"action": "feed_ingest_failed", "url": "%s", "error": "%s"', body.url, exc)

    db.commit()
    db.refresh(feed)

    logger.info(
        '"action": "feed_added", "feed_id": "%s", "url": "%s", "mode": "%s"',
        feed.id, feed.url, feed.mode,
    )
    return FeedResponse.model_validate(feed)


@router.get("/feeds", response_model=list[FeedResponse])
def list_feeds(db: Session = Depends(get_db)) -> list[FeedResponse]:
    feeds = db.query(Feed).order_by(Feed.created_at.desc()).all()
    return [FeedResponse.model_validate(f) for f in feeds]


@router.delete("/feeds/{feed_id}", status_code=204)
def delete_feed(
    feed_id: str,
    delete_episodes: bool = Query(False),
    db: Session = Depends(get_db),
) -> None:
    feed = db.query(Feed).filter(Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")

    if not delete_episodes:
        # Detach episodes from feed rather than cascading delete
        for ep in feed.episodes:
            ep.feed_id = None
        db.flush()

    db.delete(feed)
    db.commit()
    logger.info('"action": "feed_deleted", "feed_id": "%s"', feed_id)


@router.post("/feeds/{feed_id}/poll", status_code=202)
def poll_feed(feed_id: str, db: Session = Depends(get_db)) -> dict:
    """Trigger an immediate out-of-schedule poll for new episodes."""
    feed = db.query(Feed).filter(Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    _ingest_feed(feed.id)
    return {"queued": True}
