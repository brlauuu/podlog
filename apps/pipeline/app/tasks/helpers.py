"""Shared helpers for pipeline task state transitions."""
from datetime import datetime, timezone
import logging

from app.models import Episode
from app.services.notification_runtime import emit_episode_failed_event

logger = logging.getLogger(__name__)


def update_episode(db, episode_id: str, **kwargs) -> None:
    """Update episode fields with automatic updated_at timestamp."""
    kwargs.setdefault("updated_at", datetime.now(timezone.utc))
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if episode is None:
        raise RuntimeError(f"Episode {episode_id} not found for update")
    for key, value in kwargs.items():
        setattr(episode, key, value)
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

    # Emit failure notification on terminal failure:
    # - retries exhausted, OR
    # - non-retryable error class (DISK_FULL, OOM, SYSTEM_ERROR from zombies)
    _NON_RETRYABLE = {"DISK_FULL", "OOM", "SYSTEM_ERROR", "FIREWORKS_UPLOAD_REJECTED"}
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if episode and (error_class in _NON_RETRYABLE or episode.retry_count >= episode.retry_max):
        emit_episode_failed_event(
            db,
            episode,
            error_class=error_class,
            error_message=error_message,
        )
