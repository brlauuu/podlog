"""Notification digest — event logging, scheduling, and digest formatting/delivery."""
import json
import logging
from dataclasses import asdict
from datetime import datetime

from app.database import SessionLocal
from app.models import NotificationLog
from app.services.events import Event
from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent

logger = logging.getLogger(__name__)


def _serialize_event(event: Event) -> str:
    """Serialize an event dataclass to JSON, handling datetime fields."""
    data = asdict(event)
    for key, value in data.items():
        if isinstance(value, datetime):
            data[key] = value.isoformat()
    return json.dumps(data)


def log_event(event: Event, mark_sent: bool = False) -> None:
    """Write an event to the notification_log table.

    Args:
        event: The event to log.
        mark_sent: If True, mark the row as already sent (used for failed events
                   that are sent immediately but still logged for digest inclusion).
    """
    if isinstance(event, EpisodeDoneEvent):
        event_type = "episode.done"
        episode_id = event.episode_id
    elif isinstance(event, EpisodeFailedEvent):
        event_type = "episode.failed"
        episode_id = event.episode_id
    else:
        logger.warning('"action": "digest_log_unknown_event", "type": "%s"', type(event).__name__)
        return

    db = SessionLocal()
    try:
        row = NotificationLog(
            event_type=event_type,
            episode_id=episode_id,
            payload=_serialize_event(event),
            sent=mark_sent,
        )
        db.add(row)
        db.commit()
        logger.info(
            '"action": "event_logged", "event_type": "%s", "episode_id": "%s", "sent": %s',
            event_type, episode_id, mark_sent,
        )
    finally:
        db.close()
