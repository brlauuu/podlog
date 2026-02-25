"""
Celery Beat schedule — PRD-01 §5.10

Polls all registered feeds every FEED_POLL_INTERVAL_HOURS hours.
"""
from celery.schedules import crontab

from app.config import settings
from app.tasks.celery_app import celery_app


@celery_app.on_after_finalize.connect
def setup_periodic_tasks(sender, **kwargs):
    interval_hours = settings.feed_poll_interval_hours
    sender.add_periodic_task(
        interval_hours * 3600,
        poll_all_feeds.s(),
        name=f"poll-all-feeds-every-{interval_hours}h",
    )


@celery_app.task(name="poll_all_feeds")
def poll_all_feeds() -> dict:
    """Poll all registered feeds for new episodes."""
    from app.database import SessionLocal
    from app.models import Feed
    from app.tasks.ingest import ingest_feed

    db = SessionLocal()
    try:
        feeds = db.query(Feed).all()
        for feed in feeds:
            ingest_feed.delay(feed.id)
        return {"polled": len(feeds)}
    finally:
        db.close()
