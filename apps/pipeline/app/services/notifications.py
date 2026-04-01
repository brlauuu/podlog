"""Notification events, queue estimation, and delivery handlers."""
import logging
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Episode
from app.services.events import Event

logger = logging.getLogger(__name__)


@dataclass
class EpisodeDoneEvent(Event):
    episode_id: str = ""
    episode_title: str = ""
    podcast_title: str = ""
    published_at: datetime | None = None
    duration_secs: int | None = None
    transcribe_duration_secs: float | None = None
    diarize_duration_secs: float | None = None
    total_duration_secs: float | None = None
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None


@dataclass
class EpisodeFailedEvent(Event):
    episode_id: str = ""
    episode_title: str = ""
    podcast_title: str = ""
    published_at: datetime | None = None
    duration_secs: int | None = None
    error_class: str = ""
    error_message: str = ""
    retry_count: int = 0
    retry_max: int = 3
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None


def estimate_queue_status(db: Session) -> tuple[int, float | None]:
    """Return (remaining_count, estimated_seconds_to_complete).

    The estimate uses a duration-weighted processing rate from the last 10
    completed episodes. Returns None for estimate if no history is available.
    """
    # Count pending/in-progress episodes
    remaining = (
        db.query(Episode)
        .filter(Episode.status.in_(["pending", "downloading", "transcribing", "diarizing", "archiving"]))
        .count()
    )

    # Get recent completed episodes for rate calculation
    recent = (
        db.query(Episode)
        .filter(
            Episode.status == "done",
            Episode.processed_at.isnot(None),
            Episode.duration_secs.isnot(None),
        )
        .order_by(Episode.processed_at.desc())
        .limit(10)
        .all()
    )

    if not recent:
        return remaining, None

    # Compute duration-weighted processing rate
    total_wall = 0.0
    total_audio = 0.0
    for ep in recent:
        wall_secs = (ep.processed_at - ep.created_at).total_seconds()
        total_wall += wall_secs
        total_audio += ep.duration_secs

    if total_audio == 0:
        return remaining, None

    rate = total_wall / total_audio  # wall seconds per audio second

    # Sum duration of queued episodes
    queued_episodes = (
        db.query(Episode)
        .filter(Episode.status.in_(["pending", "downloading", "transcribing", "diarizing", "archiving"]))
        .all()
    )
    queued_audio = sum(ep.duration_secs or 0 for ep in queued_episodes)

    return remaining, queued_audio * rate
