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
    _NON_RETRYABLE = {"DISK_FULL", "OOM", "SYSTEM_ERROR"}
    episode = db.query(Episode).filter(Episode.id == episode_id).first()
    if episode and (error_class in _NON_RETRYABLE or episode.retry_count >= episode.retry_max):
        emit_episode_failed_event(
            db,
            episode,
            error_class=error_class,
            error_message=error_message,
        )


# Statuses an episode can rest in permanently. Anything NOT in this set is
# treated as mid-pipeline by recover_stranded_episodes and by the queue
# dashboard's "active jobs" queries.
#
# Defined once on purpose (#955). These were previously written as the literal
# tuple ('done', 'failed') in several places, so adding `no_speech` would have
# made a finished episode look stranded -- and the stranded-recovery task would
# have re-enqueued it forever.
#
# The web app mirrors this in apps/web/src/lib/queueStatus.ts::TERMINAL_STATUSES.
# Keep the two in step; a parity test asserts they match.
TERMINAL_STATUSES = frozenset({"done", "failed", "no_speech"})


def mark_no_speech(db, episode_id: str, message: str) -> None:
    """Terminate an episode that transcribed to nothing (#955).

    Deliberately not routed through ``mark_failed``: nothing malfunctioned.
    Download, transcription and diarization all worked and correctly reported
    that the audio contains no speech, so classifying it as SYSTEM_ERROR sends
    an operator looking for a broken pipeline. It also skips the failure
    notification for the same reason -- this is an outcome, not an incident.
    """
    update_episode(
        db, episode_id,
        status="no_speech",
        error_class="NO_SPEECH",
        error_message=message,
    )
    logger.info(
        '"action": "episode_no_speech", "episode_id": "%s", "detail": "%s"',
        episode_id, message,
    )
