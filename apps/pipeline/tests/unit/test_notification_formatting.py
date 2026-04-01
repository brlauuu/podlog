"""Tests for notification message formatting (HTML email + Telegram Markdown)."""
from datetime import datetime, timezone

from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    format_done_html,
    format_done_telegram,
    format_failed_html,
    format_failed_telegram,
)


def _make_done_event() -> EpisodeDoneEvent:
    return EpisodeDoneEvent(
        episode_id="abc",
        episode_title="How AI Works",
        podcast_title="Tech Talk",
        published_at=datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.5,
        diarize_duration_secs=60.2,
        total_duration_secs=200.0,
        queue_remaining=5,
        queue_estimated_secs=3600.0,
    )


def _make_failed_event() -> EpisodeFailedEvent:
    return EpisodeFailedEvent(
        episode_id="abc",
        episode_title="How AI Works",
        podcast_title="Tech Talk",
        published_at=datetime(2026, 3, 15, 12, 0, tzinfo=timezone.utc),
        duration_secs=3600,
        error_class="OOM",
        error_message="Out of memory during transcription",
        retry_count=3,
        retry_max=3,
        queue_remaining=2,
        queue_estimated_secs=1800.0,
    )


def test_format_done_html_contains_key_info():
    html = format_done_html(_make_done_event())
    assert "Tech Talk" in html
    assert "How AI Works" in html
    assert "1:00:00" in html  # duration
    assert "2m 00s" in html or "2m 01s" in html  # transcribe time ~120s
    assert "1m 00s" in html  # diarize time ~60s
    assert "5" in html  # queue remaining
    assert "<html" in html.lower()


def test_format_done_telegram_contains_key_info():
    md = format_done_telegram(_make_done_event())
    assert "Tech Talk" in md
    assert "How AI Works" in md
    assert "1:00:00" in md
    assert "5" in md


def test_format_failed_html_contains_error():
    html = format_failed_html(_make_failed_event())
    assert "OOM" in html
    assert "Out of memory" in html
    assert "3/3" in html  # retries
    assert "<html" in html.lower()


def test_format_failed_telegram_contains_error():
    md = format_failed_telegram(_make_failed_event())
    assert "OOM" in md
    assert "Out of memory" in md
    assert "3/3" in md


def test_format_done_html_unknown_queue_estimate():
    event = _make_done_event()
    event.queue_estimated_secs = None
    html = format_done_html(event)
    assert "unknown" in html.lower()


def test_format_done_telegram_unknown_queue_estimate():
    event = _make_done_event()
    event.queue_estimated_secs = None
    md = format_done_telegram(event)
    assert "unknown" in md.lower()
