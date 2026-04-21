"""
Feed management API — control-plane endpoints.

GET    /api/feeds                       List feeds with episode counts
GET    /api/feeds/preview               Preview a feed URL (returns metadata + episodes, no DB writes)
POST   /api/feeds                       Add a new RSS feed (with validation — GAP-02)
DELETE /api/feeds/{id}                  Remove a feed (optionally delete episodes)
POST   /api/feeds/{id}/poll             Trigger immediate re-poll
GET    /api/feeds/{id}/episodes/guids   List GUIDs already ingested for a feed (#487)
POST   /api/feeds/{id}/episodes         Add more episodes to a selective feed (#487)
"""
import logging
from datetime import datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import Episode, Feed
from app.services import rss as rss_service
from app.tasks.ingest import ingest_feed as _ingest_feed

logger = logging.getLogger(__name__)
router = APIRouter()


class AddFeedRequest(BaseModel):
    url: str
    mode: Literal["test", "full", "selective"] = "full"
    # Issue #84: required when mode == "selective"; ignored for test/full
    selected_guids: Optional[list[str]] = None


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


class EpisodePreview(BaseModel):
    guid: str
    title: Optional[str]
    published_at: Optional[datetime]
    duration_secs: Optional[int]
    audio_url: str


class FeedPreviewResponse(BaseModel):
    title: Optional[str]
    description: Optional[str]
    image_url: Optional[str]
    website_url: Optional[str]
    episodes: list[EpisodePreview]


class FeedListItem(BaseModel):
    id: str
    url: str
    title: Optional[str]
    mode: str
    last_polled_at: Optional[datetime]
    episode_count: int


@router.get("/feeds", response_model=list[FeedListItem])
def list_feeds(db: Session = Depends(get_db)) -> list[FeedListItem]:
    """
    Return feeds with episode counts for the web feed-management UI.
    """
    rows = (
        db.execute(
            text(
                """
                SELECT f.id::text AS id, f.url, f.title, f.mode, f.last_polled_at,
                       COUNT(e.id)::int AS episode_count
                FROM feeds f
                LEFT JOIN episodes e ON e.feed_id = f.id
                GROUP BY f.id
                ORDER BY f.created_at DESC
                """
            )
        )
        .mappings()
        .all()
    )
    return [FeedListItem.model_validate(dict(row)) for row in rows]


@router.get("/feeds/preview", response_model=FeedPreviewResponse)
def preview_feed(url: str = Query(..., description="RSS feed URL to preview")) -> FeedPreviewResponse:
    """
    Fetch a feed URL and return its metadata + episode list without persisting anything.
    Used by the frontend to show episode selection before adding a feed (issue #84).
    """
    try:
        preview = rss_service.preview_feed(url)
    except rss_service.InvalidFeedError as exc:
        raise HTTPException(status_code=422, detail=str(exc))

    return FeedPreviewResponse(
        title=preview.feed.title,
        description=preview.feed.description,
        image_url=preview.feed.image_url,
        website_url=preview.feed.website_url,
        episodes=[
            EpisodePreview(
                guid=ep.guid,
                title=ep.title,
                published_at=ep.published_at,
                duration_secs=ep.duration_secs,
                audio_url=ep.audio_url,
            )
            for ep in preview.episodes
        ],
    )


@router.post("/feeds", response_model=FeedResponse, status_code=201)
def add_feed(body: AddFeedRequest, db: Session = Depends(get_db)) -> FeedResponse:
    """
    Add a new RSS feed. Validates the URL is a parseable RSS/Atom feed (GAP-02)
    before persisting. Enqueues ingestion of all existing episodes.

    Issue #23: If a feed already exists in test mode and is re-added in full mode,
    it gets promoted and remaining episodes are ingested.
    Issue #84: selective mode requires selected_guids; only those episodes are ingested.
    """
    # Issue #84: validate selective mode has at least one GUID
    if body.mode == "selective":
        if not body.selected_guids:
            raise HTTPException(
                status_code=422,
                detail="selected_guids is required and must be non-empty for selective mode",
            )

    # Check for existing feed first -- handle test->full promotion
    existing = db.query(Feed).filter(Feed.url == body.url).first()
    if existing:
        if existing.mode in ("test", "selective") and body.mode == "full":
            # Promote test/selective -> full: flip mode and re-ingest to pick up remaining episodes
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
        itunes_author=feed_meta.itunes_author,
        itunes_owner_name=feed_meta.itunes_owner_name,
        podcast_persons=feed_meta.podcast_persons or None,
        mode=body.mode,
    )
    db.add(feed)
    db.commit()
    db.refresh(feed)

    # Trigger ingestion (creates download jobs for each episode).
    # Called after commit so ingest_feed's own session can see the feed row.
    try:
        _ingest_feed(feed.id, selected_guids=body.selected_guids)
    except Exception as exc:
        # Feed is saved but ingestion failed — not fatal, can be re-polled
        logger.error('"action": "feed_ingest_failed", "url": "%s", "error": "%s"', body.url, exc)

    logger.info(
        '"action": "feed_added", "feed_id": "%s", "url": "%s", "mode": "%s"',
        feed.id, feed.url, feed.mode,
    )
    return FeedResponse.model_validate(feed)


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
    # Issue #84: selective feeds have a fixed episode set — polling adds nothing
    if feed.mode == "selective":
        raise HTTPException(
            status_code=422,
            detail="Selective feeds cannot be re-polled. Promote to full mode to ingest new episodes.",
        )
    _ingest_feed(feed.id)
    return {"queued": True}


class AddEpisodesRequest(BaseModel):
    selected_guids: list[str]


class AddEpisodesResponse(BaseModel):
    queued: int
    skipped: int


@router.get("/feeds/{feed_id}/episodes/guids", response_model=list[str])
def list_feed_episode_guids(feed_id: str, db: Session = Depends(get_db)) -> list[str]:
    """
    Return the GUIDs of episodes already ingested for this feed.
    Used by the web UI (#487) to mark already-selected episodes in the
    "Add more episodes" preview dialog.
    """
    feed = db.query(Feed).filter(Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    rows = db.query(Episode.guid).filter(Episode.feed_id == feed_id).all()
    return [row[0] for row in rows]


@router.post("/feeds/{feed_id}/episodes", response_model=AddEpisodesResponse, status_code=202)
def add_feed_episodes(
    feed_id: str,
    body: AddEpisodesRequest,
    db: Session = Depends(get_db),
) -> AddEpisodesResponse:
    """
    Add more episodes to an existing selective feed (#487).

    Only valid for selective-mode feeds. GUIDs already ingested are silently
    skipped (idempotent). Unknown GUIDs (not present in the live feed) cause
    a 422, matching the validation performed by ingest_feed itself.
    """
    feed = db.query(Feed).filter(Feed.id == feed_id).first()
    if not feed:
        raise HTTPException(status_code=404, detail="Feed not found")
    if feed.mode != "selective":
        raise HTTPException(
            status_code=422,
            detail="Only selective feeds support adding specific episodes. "
                   "Full feeds auto-ingest all episodes; test feeds should be promoted first.",
        )
    if not body.selected_guids:
        raise HTTPException(
            status_code=422,
            detail="selected_guids is required and must be non-empty",
        )

    existing_guids = {
        row[0]
        for row in db.query(Episode.guid).filter(Episode.feed_id == feed_id).all()
    }
    new_guids = [g for g in body.selected_guids if g not in existing_guids]
    skipped = len(body.selected_guids) - len(new_guids)

    if not new_guids:
        logger.info(
            '"action": "add_feed_episodes_noop", "feed_id": "%s", "skipped": %d',
            feed_id, skipped,
        )
        return AddEpisodesResponse(queued=0, skipped=skipped)

    result = _ingest_feed(feed_id, selected_guids=new_guids)
    if isinstance(result, dict) and result.get("error"):
        raise HTTPException(status_code=422, detail=result["error"])

    queued = int(result.get("new_episodes", 0)) if isinstance(result, dict) else 0
    logger.info(
        '"action": "feed_episodes_added", "feed_id": "%s", "queued": %d, "skipped": %d',
        feed_id, queued, skipped,
    )
    return AddEpisodesResponse(queued=queued, skipped=skipped)
