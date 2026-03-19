"""Shared helpers for pipeline task state transitions."""
from datetime import datetime, timezone
import logging

from app.models import Episode

logger = logging.getLogger(__name__)


def update_episode(db, episode_id: str, **kwargs) -> None:
    """Update episode fields with automatic updated_at timestamp."""
    kwargs.setdefault("updated_at", datetime.now(timezone.utc))
    db.query(Episode).filter(Episode.id == episode_id).update(kwargs)
    db.commit()


def mark_failed(db, episode_id: str, error_class: str, error_message: str) -> None:
    """Mark an episode as failed with error classification."""
    update_episode(
        db, episode_id,
        status="failed",
        error_class=error_class,
        error_message=error_message,
    )
    logger.error(
        '"action": "task_error", "episode_id": "%s", "error_class": "%s", "error": "%s"',
        episode_id, error_class, error_message,
    )
