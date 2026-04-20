"""Notification events, queue estimation, and delivery handlers."""
import httpx
import logging
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.services.events import Event
from app.services.notification_events import EpisodeDoneEvent, EpisodeFailedEvent
from app.services.notification_runtime import (
    compute_avg_duration,
    compute_avg_processing_stats,
    estimate_queue_status,
)
from app.services.timing_labels import humanize_timing_key

logger = logging.getLogger(__name__)


def _fmt_duration(secs: float | int | None) -> str:
    """Format seconds with unit labels: 1h 30m 00s, 2m 30s, 0m 45s."""
    if secs is None:
        return "—"
    total = int(secs)
    h, remainder = divmod(total, 3600)
    m, s = divmod(remainder, 60)
    if h > 0:
        return f"{h}h {m:02d}m {s:02d}s"
    return f"{m}m {s:02d}s"


def _fmt_short_duration(secs: float | None) -> str:
    """Format seconds as Xm Ys for shorter durations, Xh Ym Zs for longer."""
    if secs is None:
        return "—"
    return _fmt_duration(secs)


def _fmt_date(dt: datetime | None) -> str:
    if dt is None:
        return "—"
    return dt.strftime("%b %d, %Y")


def _fmt_estimate(secs: float | None) -> str:
    if secs is None:
        return "Unknown"
    return _fmt_duration(secs)


def _fmt_factor(factor: float | None) -> str:
    if factor is None:
        return "—"
    return f"{factor:.1f}x"


def _provider_label(provider: str | None) -> str:
    """Human label for an inference provider, used in averages section headers."""
    if provider == "local":
        return "local episodes"
    if provider == "fireworks":
        return "remote episodes"
    if provider:
        return f"{provider} episodes"
    return "all episodes"


def _fmt_diarize_steps_html(step_durations: dict[str, float] | None) -> str:
    if not step_durations:
        return ""
    rows = []
    for idx, (name, secs) in enumerate(step_durations.items()):
        row_bg = ' style="background: #f9f9f9;"' if idx % 2 else ""
        rows.append(
            f"""\
    <tr{row_bg}><td style="padding: 4px 12px; color: #666;">{humanize_timing_key(name)}</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(secs)}</td></tr>"""
        )
    rows_html = "\n".join(rows)
    return f"""\
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Diarization Step Breakdown</h3>
  <table style="border-collapse: collapse; width: 100%;">
{rows_html}
  </table>"""


def _fmt_diarize_steps_telegram(step_durations: dict[str, float] | None) -> str:
    if not step_durations:
        return ""
    lines = "\n*Diarization Step Breakdown*\n"
    for name, secs in step_durations.items():
        lines += f"`{humanize_timing_key(name)}: {_fmt_short_duration(secs)}`\n"
    return lines


def _fmt_avg_section_html(event) -> str:
    """Render the HTML averages section if avg data is available."""
    if (event.avg_transcribe_secs is None and event.avg_diarize_secs is None
            and event.avg_total_secs is None and event.avg_duration_secs is None
            and event.processing_factor is None):
        return ""
    avg_duration_row = ""
    if event.avg_duration_secs is not None:
        avg_duration_row = f"""\
    <tr><td style="padding: 4px 12px; color: #666;">Avg episode length</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(event.avg_duration_secs)}</td></tr>"""
    factor_row = ""
    if event.processing_factor is not None:
        factor_row = f"""\
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Avg processing factor</td>
        <td style="padding: 4px 12px; font-weight: 600;">{_fmt_factor(event.processing_factor)}</td></tr>"""
    scope_label = _provider_label(getattr(event, "inference_provider_used", None))
    return f"""\
  <h3 style="margin-top: 20px; margin-bottom: 8px;">Avg Processing Time ({scope_label})</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Avg transcription</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(event.avg_transcribe_secs)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Avg diarization</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(event.avg_diarize_secs)}</td></tr>
    <tr><td style="padding: 4px 12px; color: #666;">Avg per episode</td>
        <td style="padding: 4px 12px; font-weight: 600;">{_fmt_short_duration(event.avg_total_secs)}</td></tr>
{avg_duration_row}
{factor_row}
  </table>"""


def _fmt_avg_section_telegram(event) -> str:
    """Render the Telegram averages section if avg data is available."""
    if (event.avg_transcribe_secs is None and event.avg_diarize_secs is None
            and event.avg_total_secs is None and event.avg_duration_secs is None
            and event.processing_factor is None):
        return ""
    scope_label = _provider_label(getattr(event, "inference_provider_used", None))
    lines = (
        f"\n*Avg Processing Time ({scope_label})*\n"
        f"`Avg transcribe:  {_fmt_short_duration(event.avg_transcribe_secs)}`\n"
        f"`Avg diarize:     {_fmt_short_duration(event.avg_diarize_secs)}`\n"
        f"`Avg per episode: {_fmt_short_duration(event.avg_total_secs)}`\n"
    )
    if event.avg_duration_secs is not None:
        lines += f"`Avg ep. length:  {_fmt_short_duration(event.avg_duration_secs)}`\n"
    if event.processing_factor is not None:
        lines += f"`Avg processing factor: {_fmt_factor(event.processing_factor)}`\n"
    return lines


def format_done_html(event: EpisodeDoneEvent) -> str:
    avg_html = _fmt_avg_section_html(event)
    diarize_steps_html = _fmt_diarize_steps_html(event.diarize_step_durations)
    episode_factor_row = ""
    if event.episode_processing_factor is not None:
        episode_factor_row = f"""\
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Processing factor</td>
        <td style="padding: 4px 12px; font-weight: 600;">{_fmt_factor(event.episode_processing_factor)}</td></tr>"""
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
{episode_factor_row}
  </table>
{diarize_steps_html}
{avg_html}
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
    avg_section = _fmt_avg_section_telegram(event)
    diarize_steps_section = _fmt_diarize_steps_telegram(event.diarize_step_durations)
    episode_factor_line = ""
    if event.episode_processing_factor is not None:
        episode_factor_line = (
            f"`Processing factor: {_fmt_factor(event.episode_processing_factor)}`\n"
        )
    return (
        f"*✅ Episode Processed*\n\n"
        f"*Podcast:* {event.podcast_title}\n"
        f"*Episode:* {event.episode_title}\n"
        f"*Published:* {_fmt_date(event.published_at)}\n"
        f"*Duration:* {_fmt_duration(event.duration_secs)}\n\n"
        f"*Processing Time*\n"
        f"`Transcription:  {_fmt_short_duration(event.transcribe_duration_secs)}`\n"
        f"`Diarization:    {_fmt_short_duration(event.diarize_duration_secs)}`\n"
        f"`Total:          {_fmt_short_duration(event.total_duration_secs)}`\n"
        f"{episode_factor_line}"
        f"{diarize_steps_section}"
        f"{avg_section}\n"
        f"*Queue:* {event.queue_remaining} remaining · Est. {_fmt_estimate(event.queue_estimated_secs)}"
    )


def format_failed_html(event: EpisodeFailedEvent) -> str:
    avg_html = _fmt_avg_section_html(event)
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
{avg_html}
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
    avg_section = _fmt_avg_section_telegram(event)
    return (
        f"*❌ Episode Failed*\n\n"
        f"*Podcast:* {event.podcast_title}\n"
        f"*Episode:* {event.episode_title}\n"
        f"*Published:* {_fmt_date(event.published_at)}\n"
        f"*Duration:* {_fmt_duration(event.duration_secs)}\n\n"
        f"*Error*\n"
        f"`Class:    {event.error_class}`\n"
        f"`Details:  {event.error_message}`\n"
        f"`Retries:  {event.retry_count}/{event.retry_max}`\n"
        f"{avg_section}\n"
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
