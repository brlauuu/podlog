"""Notification events, queue estimation, and delivery handlers."""
import httpx
import logging
import smtplib
from dataclasses import dataclass
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

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


def _fmt_duration(secs: float | int | None) -> str:
    """Format seconds as h:mm:ss."""
    if secs is None:
        return "—"
    total = int(secs)
    h, remainder = divmod(total, 3600)
    m, s = divmod(remainder, 60)
    return f"{h}:{m:02d}:{s:02d}"


def _fmt_short_duration(secs: float | None) -> str:
    """Format seconds as Xm Ys for shorter durations."""
    if secs is None:
        return "—"
    total = int(secs)
    if total >= 3600:
        return _fmt_duration(secs)
    m, s = divmod(total, 60)
    return f"{m}m {s:02d}s"


def _fmt_date(dt: datetime | None) -> str:
    if dt is None:
        return "—"
    return dt.strftime("%b %d, %Y")


def _fmt_estimate(secs: float | None) -> str:
    if secs is None:
        return "Unknown"
    return _fmt_duration(secs)


def format_done_html(event: EpisodeDoneEvent) -> str:
    return f"""\
<html>
<body style="font-family: -apple-system, Arial, sans-serif; color: #222; max-width: 520px; margin: 0 auto; padding: 16px;">
  <h2 style="color: #16a34a; margin-bottom: 4px;">&#9989; Episode Processed</h2>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
    <tr><td style="padding: 6px 12px; color: #666;">Podcast</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.podcast_title}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Episode</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.episode_title}</td></tr>
    <tr><td style="padding: 6px 12px; color: #666;">Published</td>
        <td style="padding: 6px 12px;">{_fmt_date(event.published_at)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Duration</td>
        <td style="padding: 6px 12px;">{_fmt_duration(event.duration_secs)}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Processing Time</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Transcription</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(event.transcribe_duration_secs)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Diarization</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(event.diarize_duration_secs)}</td></tr>
    <tr><td style="padding: 4px 12px; color: #666;">Total</td>
        <td style="padding: 4px 12px; font-weight: 600;">{_fmt_short_duration(event.total_duration_secs)}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Queue Status</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Remaining</td>
        <td style="padding: 4px 12px;">{event.queue_remaining} episodes</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Est. time left</td>
        <td style="padding: 4px 12px;">{_fmt_estimate(event.queue_estimated_secs)}</td></tr>
  </table>
  <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">Sent by Podlog</p>
</body>
</html>"""


def format_done_telegram(event: EpisodeDoneEvent) -> str:
    return (
        f"*✅ Episode Processed*\n\n"
        f"*Podcast:* {event.podcast_title}\n"
        f"*Episode:* {event.episode_title}\n"
        f"*Published:* {_fmt_date(event.published_at)}\n"
        f"*Duration:* {_fmt_duration(event.duration_secs)}\n\n"
        f"*Processing Time*\n"
        f"`Transcription:  {_fmt_short_duration(event.transcribe_duration_secs)}`\n"
        f"`Diarization:    {_fmt_short_duration(event.diarize_duration_secs)}`\n"
        f"`Total:          {_fmt_short_duration(event.total_duration_secs)}`\n\n"
        f"*Queue:* {event.queue_remaining} remaining · Est. {_fmt_estimate(event.queue_estimated_secs)}"
    )


def format_failed_html(event: EpisodeFailedEvent) -> str:
    return f"""\
<html>
<body style="font-family: -apple-system, Arial, sans-serif; color: #222; max-width: 520px; margin: 0 auto; padding: 16px;">
  <h2 style="color: #dc2626; margin-bottom: 4px;">&#10060; Episode Failed</h2>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
    <tr><td style="padding: 6px 12px; color: #666;">Podcast</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.podcast_title}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Episode</td>
        <td style="padding: 6px 12px; font-weight: 600;">{event.episode_title}</td></tr>
    <tr><td style="padding: 6px 12px; color: #666;">Published</td>
        <td style="padding: 6px 12px;">{_fmt_date(event.published_at)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 6px 12px; color: #666;">Duration</td>
        <td style="padding: 6px 12px;">{_fmt_duration(event.duration_secs)}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px; color: #dc2626;">Error</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Class</td>
        <td style="padding: 4px 12px; font-weight: 600;">{event.error_class}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Details</td>
        <td style="padding: 4px 12px;">{event.error_message}</td></tr>
    <tr><td style="padding: 4px 12px; color: #666;">Retries</td>
        <td style="padding: 4px 12px;">{event.retry_count}/{event.retry_max}</td></tr>
  </table>
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Queue Status</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Remaining</td>
        <td style="padding: 4px 12px;">{event.queue_remaining} episodes</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Est. time left</td>
        <td style="padding: 4px 12px;">{_fmt_estimate(event.queue_estimated_secs)}</td></tr>
  </table>
  <hr style="margin-top: 24px; border: none; border-top: 1px solid #eee;">
  <p style="font-size: 12px; color: #999;">Sent by Podlog</p>
</body>
</html>"""


def format_failed_telegram(event: EpisodeFailedEvent) -> str:
    return (
        f"*❌ Episode Failed*\n\n"
        f"*Podcast:* {event.podcast_title}\n"
        f"*Episode:* {event.episode_title}\n"
        f"*Published:* {_fmt_date(event.published_at)}\n"
        f"*Duration:* {_fmt_duration(event.duration_secs)}\n\n"
        f"*Error*\n"
        f"`Class:    {event.error_class}`\n"
        f"`Details:  {event.error_message}`\n"
        f"`Retries:  {event.retry_count}/{event.retry_max}`\n\n"
        f"*Queue:* {event.queue_remaining} remaining · Est. {_fmt_estimate(event.queue_estimated_secs)}"
    )


def send_email(
    event: Event,
    to_addr: str,
    from_addr: str,
    smtp_host: str,
    smtp_port: int,
    smtp_user: str | None = None,
    smtp_password: str | None = None,
    use_tls: bool = False,
) -> None:
    """Send an HTML notification email for the given event."""
    if isinstance(event, EpisodeDoneEvent):
        subject = f"✅ Podlog: {event.episode_title} processed"
        html = format_done_html(event)
    elif isinstance(event, EpisodeFailedEvent):
        subject = f"❌ Podlog: {event.episode_title} failed"
        html = format_failed_html(event)
    else:
        logger.warning('"action": "email_unknown_event", "type": "%s"', type(event).__name__)
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_addr
    msg.attach(MIMEText(html, "html"))

    with smtplib.SMTP(smtp_host, smtp_port) as server:
        if use_tls:
            server.starttls()
        if smtp_user and smtp_password:
            server.login(smtp_user, smtp_password)
        server.send_message(msg)

    logger.info('"action": "email_sent", "to": "%s", "subject": "%s"', to_addr, subject)


def send_telegram(
    event: Event,
    bot_token: str,
    chat_id: str,
) -> None:
    """Send a Markdown notification via Telegram Bot API."""
    if isinstance(event, EpisodeDoneEvent):
        text = format_done_telegram(event)
    elif isinstance(event, EpisodeFailedEvent):
        text = format_failed_telegram(event)
    else:
        logger.warning('"action": "telegram_unknown_event", "type": "%s"', type(event).__name__)
        return

    url = f"https://api.telegram.org/bot{bot_token}/sendMessage"
    resp = httpx.post(url, json={
        "chat_id": chat_id,
        "text": text,
        "parse_mode": "Markdown",
    })
    resp.raise_for_status()

    logger.info('"action": "telegram_sent", "chat_id": "%s"', chat_id)
