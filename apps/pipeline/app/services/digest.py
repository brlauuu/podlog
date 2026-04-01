"""Notification digest — event logging, scheduling, and digest formatting/delivery."""
import json
import logging
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone

from app.config import settings
from app.database import SessionLocal
from app.models import NotificationLog, SystemState
from app.services.events import Event, EventBus
from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    _fmt_duration,
    _fmt_short_duration,
    _fmt_estimate,
    estimate_queue_status,
    send_email,
    send_telegram,
)

logger = logging.getLogger(__name__)

DIGEST_HOUR = 8  # 8am UTC


def is_digest_due(frequency: str, now: datetime, last_sent: datetime | None) -> bool:
    """Check whether a digest should be sent now.

    Args:
        frequency: "immediate", "daily", or "weekly"
        now: Current UTC datetime
        last_sent: When the last digest was sent (None if never)

    Returns:
        True if a digest should be sent now.
    """
    if frequency == "immediate":
        return False

    if now.hour < DIGEST_HOUR:
        return False

    if frequency == "daily":
        # Due if we haven't sent one today at/after DIGEST_HOUR
        today_digest_time = now.replace(hour=DIGEST_HOUR, minute=0, second=0, microsecond=0)
        if last_sent is None or last_sent < today_digest_time:
            return True
        return False

    if frequency == "weekly":
        # Monday = 0
        if now.weekday() != 0:
            # Not Monday — only due if we haven't sent since last Monday
            days_since_monday = now.weekday()
            last_monday = (now - timedelta(days=days_since_monday)).replace(
                hour=DIGEST_HOUR, minute=0, second=0, microsecond=0
            )
            if last_sent is None or last_sent < last_monday:
                return True
            return False
        # It is Monday
        today_digest_time = now.replace(hour=DIGEST_HOUR, minute=0, second=0, microsecond=0)
        if last_sent is None or last_sent < today_digest_time:
            return True
        return False

    return False


@dataclass
class DigestItem:
    event_type: str  # "episode.done" or "episode.failed"
    episode_title: str
    podcast_title: str
    duration_secs: int | None
    total_duration_secs: float | None  # processing time (done events)
    error_class: str | None  # failure events
    retry_count: int | None
    retry_max: int | None


@dataclass
class DigestData:
    frequency: str  # "daily" or "weekly"
    date_label: str  # e.g. "Apr 01, 2026" or "Week of Mar 30, 2026"
    items: list[DigestItem] = field(default_factory=list)
    queue_remaining: int = 0
    queue_estimated_secs: float | None = None


def format_digest_html(data: DigestData) -> str:
    freq_label = "Daily" if data.frequency == "daily" else "Weekly"
    done_count = sum(1 for i in data.items if i.event_type == "episode.done")
    failed_count = sum(1 for i in data.items if i.event_type == "episode.failed")

    rows = ""
    for idx, item in enumerate(data.items):
        bg = ' style="background: #f9f9f9;"' if idx % 2 == 1 else ""
        if item.event_type == "episode.done":
            icon = "&#9989;"
            detail = f"processed in {_fmt_short_duration(item.total_duration_secs)}"
        else:
            detail = f"{item.error_class} after {item.retry_count}/{item.retry_max} retries"
            icon = "&#10060;"
        duration = _fmt_duration(item.duration_secs)
        rows += (
            f'    <tr{bg}><td style="padding: 6px 12px;">{icon}</td>'
            f'<td style="padding: 6px 12px;">{item.episode_title}</td>'
            f'<td style="padding: 6px 12px; color: #666;">{item.podcast_title}</td>'
            f'<td style="padding: 6px 12px;">{duration}</td>'
            f'<td style="padding: 6px 12px; color: #666;">{detail}</td></tr>\n'
        )

    est = _fmt_estimate(data.queue_estimated_secs)

    return f"""\
<html>
<body style="font-family: -apple-system, Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto; padding: 16px;">
  <h2 style="margin-bottom: 4px;">&#128203; Podlog {freq_label} Digest — {data.date_label}</h2>
  <p style="color: #666;">{done_count} episodes processed, {failed_count} failed</p>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
{rows}  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Queue Status</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Remaining</td>
        <td style="padding: 4px 12px;">{data.queue_remaining} episodes</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Est. time left</td>
        <td style="padding: 4px 12px;">{est}</td></tr>
  </table>
  <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">Sent by Podlog</p>
</body>
</html>"""


def format_digest_telegram(data: DigestData) -> str:
    freq_label = "Daily" if data.frequency == "daily" else "Weekly"
    done_count = sum(1 for i in data.items if i.event_type == "episode.done")
    failed_count = sum(1 for i in data.items if i.event_type == "episode.failed")

    lines = [
        f"*📋 Podlog {freq_label} Digest — {data.date_label}*\n",
        f"{done_count} episodes processed, {failed_count} failed\n",
    ]
    for item in data.items:
        duration = _fmt_duration(item.duration_secs)
        if item.event_type == "episode.done":
            detail = f"processed in {_fmt_short_duration(item.total_duration_secs)}"
            lines.append(f"✅ \"{item.episode_title}\" ({item.podcast_title}) — {duration}, {detail}")
        else:
            lines.append(
                f"❌ \"{item.episode_title}\" ({item.podcast_title}) — "
                f"{item.error_class} after {item.retry_count}/{item.retry_max} retries"
            )

    est = _fmt_estimate(data.queue_estimated_secs)
    lines.append(f"\n*Queue:* {data.queue_remaining} remaining · Est. {est}")
    return "\n".join(lines)


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


LAST_DIGEST_KEY = "last_digest_sent_at"


def send_digest_if_due(now: datetime | None = None) -> None:
    """Check if a digest is due and send it if so. Called by the worker periodic task."""
    if settings.notification_frequency == "immediate":
        return

    if now is None:
        now = datetime.now(timezone.utc)

    db = SessionLocal()
    try:
        # Quick time-only check before hitting the DB for last_sent
        if not is_digest_due(settings.notification_frequency, now, last_sent=None):
            return

        # Read last_digest_sent_at from system_state
        state_row = db.query(SystemState).filter(SystemState.key == LAST_DIGEST_KEY).first()
        last_sent = None
        if isinstance(state_row, SystemState):
            last_sent = datetime.fromisoformat(state_row.value)

        if not is_digest_due(settings.notification_frequency, now, last_sent):
            return

        # Query unsent events
        unsent = (
            db.query(NotificationLog)
            .filter(NotificationLog.sent == False)
            .order_by(NotificationLog.created_at)
            .all()
        )

        if not unsent:
            # Update last_sent even when empty — avoid re-checking every 15 min
            _update_last_sent(db, state_row, now)
            return

        # Build digest data
        remaining, estimated = estimate_queue_status(db)
        items = []
        for row in unsent:
            payload = json.loads(row.payload)
            items.append(DigestItem(
                event_type=row.event_type,
                episode_title=payload.get("episode_title", ""),
                podcast_title=payload.get("podcast_title", ""),
                duration_secs=payload.get("duration_secs"),
                total_duration_secs=payload.get("total_duration_secs"),
                error_class=payload.get("error_class"),
                retry_count=payload.get("retry_count"),
                retry_max=payload.get("retry_max"),
            ))

        if settings.notification_frequency == "weekly":
            days_since_monday = now.weekday()
            monday = now - timedelta(days=days_since_monday)
            date_label = f"Week of {monday.strftime('%b %d, %Y')}"
        else:
            date_label = now.strftime("%b %d, %Y")

        digest = DigestData(
            frequency=settings.notification_frequency,
            date_label=date_label,
            items=items,
            queue_remaining=remaining,
            queue_estimated_secs=estimated,
        )

        # Send via configured channels
        _send_digest(digest)

        # Mark all as sent
        for row in unsent:
            row.sent = True
        db.commit()

        _update_last_sent(db, state_row, now)

        logger.info(
            '"action": "digest_sent", "frequency": "%s", "items": %d',
            settings.notification_frequency, len(items),
        )
    finally:
        db.close()


def _update_last_sent(db, state_row, now: datetime) -> None:
    """Update or create the last_digest_sent_at key in system_state."""
    if state_row is not None:
        state_row.value = now.isoformat()
    else:
        db.add(SystemState(key=LAST_DIGEST_KEY, value=now.isoformat()))
    db.commit()


def _send_digest(digest: DigestData) -> None:
    """Send digest via all configured channels."""
    import smtplib
    from email.mime.multipart import MIMEMultipart
    from email.mime.text import MIMEText

    freq_label = "Daily" if digest.frequency == "daily" else "Weekly"

    if settings.email_notifications_enabled:
        html = format_digest_html(digest)
        subject = f"📋 Podlog {freq_label} Digest — {digest.date_label}"

        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = settings.notification_email_from
        msg["To"] = settings.notification_email_to
        msg.attach(MIMEText(html, "html"))

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port) as server:
            if settings.smtp_use_tls:
                server.starttls()
            if settings.smtp_user and settings.smtp_password:
                server.login(settings.smtp_user, settings.smtp_password)
            server.send_message(msg)

    if settings.telegram_notifications_enabled:
        import httpx
        text = format_digest_telegram(digest)
        url = f"https://api.telegram.org/bot{settings.telegram_bot_token}/sendMessage"
        resp = httpx.post(url, json={
            "chat_id": settings.telegram_chat_id,
            "text": text,
            "parse_mode": "Markdown",
        })
        resp.raise_for_status()


def register_notification_handlers(bus: EventBus) -> None:
    """Register notification handlers on the event bus based on config.

    - immediate: send directly for both done and failed events
    - daily/weekly: log done events to DB, send failed events immediately + log them
    """
    if not settings.email_notifications_enabled and not settings.telegram_notifications_enabled:
        return

    if settings.notification_frequency == "immediate":
        # Direct send for all events
        if settings.email_notifications_enabled:
            def _email_handler(event):
                send_email(
                    event,
                    to_addr=settings.notification_email_to,
                    from_addr=settings.notification_email_from,
                    smtp_host=settings.smtp_host,
                    smtp_port=settings.smtp_port,
                    smtp_user=settings.smtp_user,
                    smtp_password=settings.smtp_password,
                    use_tls=settings.smtp_use_tls,
                )
            bus.subscribe(EpisodeDoneEvent, _email_handler)
            bus.subscribe(EpisodeFailedEvent, _email_handler)

        if settings.telegram_notifications_enabled:
            def _telegram_handler(event):
                send_telegram(
                    event,
                    bot_token=settings.telegram_bot_token,
                    chat_id=settings.telegram_chat_id,
                )
            bus.subscribe(EpisodeDoneEvent, _telegram_handler)
            bus.subscribe(EpisodeFailedEvent, _telegram_handler)
    else:
        # Digest mode: log done events, send+log failed events
        def _log_done(event):
            log_event(event, mark_sent=False)

        def _log_and_send_failed(event):
            log_event(event, mark_sent=True)

        bus.subscribe(EpisodeDoneEvent, _log_done)
        bus.subscribe(EpisodeFailedEvent, _log_and_send_failed)

        # Also send failed events immediately
        if settings.email_notifications_enabled:
            def _email_failed(event):
                send_email(
                    event,
                    to_addr=settings.notification_email_to,
                    from_addr=settings.notification_email_from,
                    smtp_host=settings.smtp_host,
                    smtp_port=settings.smtp_port,
                    smtp_user=settings.smtp_user,
                    smtp_password=settings.smtp_password,
                    use_tls=settings.smtp_use_tls,
                )
            bus.subscribe(EpisodeFailedEvent, _email_failed)

        if settings.telegram_notifications_enabled:
            def _telegram_failed(event):
                send_telegram(
                    event,
                    bot_token=settings.telegram_bot_token,
                    chat_id=settings.telegram_chat_id,
                )
            bus.subscribe(EpisodeFailedEvent, _telegram_failed)
