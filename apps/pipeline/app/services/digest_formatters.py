"""Digest message rendering helpers (HTML and Telegram)."""
from __future__ import annotations

from html import escape

from app.services.notifications import (
    _fmt_duration,
    _fmt_short_duration,
    _fmt_estimate,
    _fmt_factor,
    _provider_label,
)
from app.services.timing_labels import humanize_timing_key


def _fmt_diarization_steps(step_durations: dict[str, float] | None) -> str:
    if not step_durations:
        return ""
    parts = [
        f"{humanize_timing_key(name)} {_fmt_short_duration(secs)}"
        for name, secs in step_durations.items()
    ]
    return f"Diarization steps: {'; '.join(parts)}"


def _render_avg_table_html(
    heading: str,
    avg_transcribe_secs: float | None,
    avg_diarize_secs: float | None,
    avg_total_secs: float | None,
    avg_duration_secs: float | None,
    processing_factor: float | None,
) -> str:
    """Render a single Avg Processing Time table (HTML)."""
    if (avg_transcribe_secs is None and avg_diarize_secs is None
            and avg_total_secs is None and avg_duration_secs is None
            and processing_factor is None):
        return ""
    avg_duration_row = ""
    if avg_duration_secs is not None:
        avg_duration_row = f"""\
    <tr><td style="padding: 4px 12px; color: #666;">Avg episode length</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(avg_duration_secs)}</td></tr>"""
    factor_row = ""
    if processing_factor is not None:
        factor_row = f"""\
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Avg processing factor</td>
        <td style="padding: 4px 12px; font-weight: 600;">{_fmt_factor(processing_factor)}</td></tr>"""
    return f"""\
  <h3 style="margin-top: 20px; margin-bottom: 8px;">{escape(heading)}</h3>
  <table style="border-collapse: collapse; width: 100%;">
    <tr><td style="padding: 4px 12px; color: #666;">Avg transcription</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(avg_transcribe_secs)}</td></tr>
    <tr style="background: #f9f9f9;">
        <td style="padding: 4px 12px; color: #666;">Avg diarization</td>
        <td style="padding: 4px 12px;">{_fmt_short_duration(avg_diarize_secs)}</td></tr>
    <tr><td style="padding: 4px 12px; color: #666;">Avg per episode</td>
        <td style="padding: 4px 12px; font-weight: 600;">{_fmt_short_duration(avg_total_secs)}</td></tr>
{avg_duration_row}
{factor_row}
  </table>
"""


def _render_avg_block_telegram(
    heading: str,
    avg_transcribe_secs: float | None,
    avg_diarize_secs: float | None,
    avg_total_secs: float | None,
    avg_duration_secs: float | None,
    processing_factor: float | None,
) -> str:
    """Render a single Avg Processing Time block (Telegram Markdown)."""
    if (avg_transcribe_secs is None and avg_diarize_secs is None
            and avg_total_secs is None and avg_duration_secs is None
            and processing_factor is None):
        return ""
    block = (
        f"\n*{heading}*\n"
        f"`Avg transcribe:  {_fmt_short_duration(avg_transcribe_secs)}`\n"
        f"`Avg diarize:     {_fmt_short_duration(avg_diarize_secs)}`\n"
        f"`Avg per episode: {_fmt_short_duration(avg_total_secs)}`"
    )
    if avg_duration_secs is not None:
        block += f"\n`Avg ep. length:  {_fmt_short_duration(avg_duration_secs)}`"
    if processing_factor is not None:
        block += f"\n`Avg processing factor: {_fmt_factor(processing_factor)}`"
    return block


def format_digest_html(data) -> str:
    freq_label = "Daily" if data.frequency == "daily" else "Weekly"
    done_count = sum(1 for i in data.items if i.event_type == "episode.done")
    failed_count = sum(1 for i in data.items if i.event_type == "episode.failed")

    rows = ""
    for idx, item in enumerate(data.items):
        bg = ' style="background: #f9f9f9;"' if idx % 2 == 1 else ""
        if item.event_type == "episode.done":
            icon = "&#9989;"
            detail = f"processed in {_fmt_short_duration(item.total_duration_secs)}"
            if item.episode_processing_factor is not None:
                detail = f"{detail} ({_fmt_factor(item.episode_processing_factor)})"
            step_detail = _fmt_diarization_steps(item.diarize_step_durations)
            if step_detail:
                detail = f"{detail}. {step_detail}"
        else:
            detail = f"{item.error_class} after {item.retry_count}/{item.retry_max} retries"
            icon = "&#10060;"
        duration = _fmt_duration(item.duration_secs)
        rows += (
            f'    <tr{bg}><td style="padding: 6px 12px;">{icon}</td>'
            f'<td style="padding: 6px 12px;">{escape(item.episode_title)}</td>'
            f'<td style="padding: 6px 12px; color: #666;">{escape(item.podcast_title)}</td>'
            f'<td style="padding: 6px 12px;">{duration}</td>'
            f'<td style="padding: 6px 12px; color: #666;">{escape(detail)}</td></tr>\n'
        )

    est = _fmt_estimate(data.queue_estimated_secs)

    provider_avgs_html = ""
    for pa in getattr(data, "provider_averages", []) or []:
        heading = f"Avg Processing Time ({_provider_label(pa.provider)})"
        provider_avgs_html += _render_avg_table_html(
            heading,
            pa.avg_transcribe_secs,
            pa.avg_diarize_secs,
            pa.avg_total_secs,
            pa.avg_duration_secs,
            pa.processing_factor,
        )

    avg_html = provider_avgs_html
    if not avg_html:
        avg_html = _render_avg_table_html(
            "Avg Processing Time (all episodes)",
            data.avg_transcribe_secs,
            data.avg_diarize_secs,
            data.avg_total_secs,
            data.avg_duration_secs,
            data.processing_factor,
        )

    return f"""\
<html>
<body style="font-family: -apple-system, Arial, sans-serif; color: #222; max-width: 600px; margin: 0 auto; padding: 16px;">
  <h2 style="margin-bottom: 4px;">&#128203; Podlog {freq_label} Digest — {data.date_label}</h2>
  <p style="color: #666;">{done_count} episodes processed, {failed_count} failed</p>
  <table style="border-collapse: collapse; width: 100%; margin-top: 12px;">
{rows}  </table>
{avg_html}  <h3 style="margin-top: 20px; margin-bottom: 8px;">Queue Status</h3>
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


def format_digest_telegram(data) -> str:
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
            if item.episode_processing_factor is not None:
                detail = f"{detail} ({_fmt_factor(item.episode_processing_factor)})"
            step_detail = _fmt_diarization_steps(item.diarize_step_durations)
            if step_detail:
                detail = f"{detail}. {step_detail}"
            lines.append(f"✅ \"{item.episode_title}\" ({item.podcast_title}) — {duration}, {detail}")
        else:
            lines.append(
                f"❌ \"{item.episode_title}\" ({item.podcast_title}) — "
                f"{item.error_class} after {item.retry_count}/{item.retry_max} retries"
            )

    provider_blocks = []
    for pa in getattr(data, "provider_averages", []) or []:
        heading = f"Avg Processing Time ({_provider_label(pa.provider)})"
        block = _render_avg_block_telegram(
            heading,
            pa.avg_transcribe_secs,
            pa.avg_diarize_secs,
            pa.avg_total_secs,
            pa.avg_duration_secs,
            pa.processing_factor,
        )
        if block:
            provider_blocks.append(block)

    if provider_blocks:
        for block in provider_blocks:
            lines.append(block)
    else:
        fallback = _render_avg_block_telegram(
            "Avg Processing Time (all episodes)",
            data.avg_transcribe_secs,
            data.avg_diarize_secs,
            data.avg_total_secs,
            data.avg_duration_secs,
            data.processing_factor,
        )
        if fallback:
            lines.append(fallback)

    est = _fmt_estimate(data.queue_estimated_secs)
    lines.append(f"\n*Queue:* {data.queue_remaining} remaining · Est. {est}")
    return "\n".join(lines)
