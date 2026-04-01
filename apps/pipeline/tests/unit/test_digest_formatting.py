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
