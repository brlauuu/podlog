"""Tests for digest message formatting (HTML + Telegram)."""
import json
from datetime import datetime, timezone

from app.services.digest import format_digest_html, format_digest_telegram, DigestData, DigestItem


def _make_digest_data() -> DigestData:
    return DigestData(
        frequency="daily",
        date_label="Apr 01, 2026",
        items=[
            DigestItem(
                event_type="episode.done",
                episode_title="How AI Works",
                podcast_title="Tech Talk",
                duration_secs=3600,
                total_duration_secs=200.0,
                diarize_step_durations={
                    "provider_diarization_secs": 42.0,
                    "speaker_assignment_secs": 13.0,
                },
                error_class=None,
                retry_count=None,
                retry_max=None,
            ),
            DigestItem(
                event_type="episode.done",
                episode_title="Episode 42",
                podcast_title="My Podcast",
                duration_secs=2700,
                total_duration_secs=130.0,
                diarize_step_durations=None,
                error_class=None,
                retry_count=None,
                retry_max=None,
            ),
            DigestItem(
                event_type="episode.failed",
                episode_title="Bad Episode",
                podcast_title="Other Pod",
                duration_secs=1800,
                total_duration_secs=None,
                diarize_step_durations=None,
                error_class="OOM",
                retry_count=3,
                retry_max=3,
            ),
        ],
        queue_remaining=5,
        queue_estimated_secs=9000.0,
    )


def test_format_digest_html_contains_summary():
    html = format_digest_html(_make_digest_data())
    assert "<html" in html.lower()
    assert "Daily Digest" in html
    assert "Apr 01, 2026" in html
    assert "How AI Works" in html
    assert "Episode 42" in html
    assert "Bad Episode" in html
    assert "OOM" in html
    assert "5" in html  # queue remaining


def test_format_digest_telegram_contains_summary():
    md = format_digest_telegram(_make_digest_data())
    assert "Daily Digest" in md
    assert "How AI Works" in md
    assert "Bad Episode" in md
    assert "OOM" in md
    assert "5" in md


def test_format_digest_html_weekly_label():
    data = _make_digest_data()
    data.frequency = "weekly"
    data.date_label = "Week of Mar 30, 2026"
    html = format_digest_html(data)
    assert "Weekly Digest" in html
    assert "Week of Mar 30, 2026" in html


def test_format_digest_html_unknown_queue_estimate():
    data = _make_digest_data()
    data.queue_estimated_secs = None
    html = format_digest_html(data)
    assert "unknown" in html.lower()


def test_format_digest_telegram_estimate_tagged_with_active_provider():
    data = _make_digest_data()
    data.queue_estimate_provider = "fireworks"
    md = format_digest_telegram(data)
    assert "(remote)" in md.split("Queue:")[1]

    data.queue_estimate_provider = "local"
    assert "(local)" in format_digest_telegram(data).split("Queue:")[1]


def test_format_digest_html_contains_averages():
    data = _make_digest_data()
    data.avg_transcribe_secs = 125.0
    data.avg_diarize_secs = 70.0
    data.avg_total_secs = 220.0
    html = format_digest_html(data)
    assert "Avg" in html or "Average" in html
    assert "2m 05s" in html  # avg transcribe
    assert "1m 10s" in html  # avg diarize
    assert "3m 40s" in html  # avg total


def test_format_digest_telegram_contains_averages():
    data = _make_digest_data()
    data.avg_transcribe_secs = 125.0
    data.avg_diarize_secs = 70.0
    data.avg_total_secs = 220.0
    md = format_digest_telegram(data)
    assert "Avg" in md or "Average" in md
    assert "2m 05s" in md
    assert "3m 40s" in md


def test_format_digest_html_duration_uses_unit_labels():
    """Episode durations in digest should use unit labels like 1h 00m 00s."""
    data = _make_digest_data()
    html = format_digest_html(data)
    assert "1h 00m 00s" in html  # first item: 3600s


def test_format_digest_telegram_duration_uses_unit_labels():
    """Episode durations in digest should use unit labels."""
    data = _make_digest_data()
    md = format_digest_telegram(data)
    assert "1h 00m 00s" in md  # first item: 3600s


def test_format_digest_html_includes_diarization_step_breakdown():
    data = _make_digest_data()
    html = format_digest_html(data)
    assert "Diarization steps:" in html
    assert "Provider diarization" in html
    assert "Speaker assignment" in html


def test_format_digest_telegram_includes_diarization_step_breakdown():
    data = _make_digest_data()
    md = format_digest_telegram(data)
    assert "Diarization steps:" in md
    assert "Provider diarization" in md
    assert "Speaker assignment" in md
