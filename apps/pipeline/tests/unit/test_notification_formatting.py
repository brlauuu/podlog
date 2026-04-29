"""Tests for notification message formatting (HTML email + Telegram Markdown)."""
from datetime import datetime, timezone

from app.services.notifications import (
    EpisodeDoneEvent,
    EpisodeFailedEvent,
    _fmt_duration,
    _fmt_short_duration,
    _fmt_estimate,
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
        diarize_step_durations={
            "provider_diarization_secs": 42.0,
            "alignment_io_secs": 5.0,
            "speaker_assignment_secs": 13.2,
        },
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
    assert "1h 00m 00s" in html  # duration with unit labels
    assert "2m 00s" in html or "2m 01s" in html  # transcribe time ~120s
    assert "1m 00s" in html  # diarize time ~60s
    assert "5" in html  # queue remaining
    assert "<html" in html.lower()


def test_format_done_telegram_contains_key_info():
    md = format_done_telegram(_make_done_event())
    assert "Tech Talk" in md
    assert "How AI Works" in md
    assert "1h 00m 00s" in md  # duration with unit labels
    assert "5" in md


def test_format_done_telegram_estimate_tagged_with_active_provider():
    """The Queue line carries the active provider so the user can read the ETA in context."""
    event = _make_done_event()
    event.queue_estimate_provider = "fireworks"
    md = format_done_telegram(event)
    assert "(remote)" in md.split("Queue:")[1]

    event.queue_estimate_provider = "local"
    md_local = format_done_telegram(event)
    assert "(local)" in md_local.split("Queue:")[1]


def test_format_done_telegram_estimate_no_tag_when_provider_unknown():
    event = _make_done_event()
    event.queue_estimate_provider = None
    md = format_done_telegram(event)
    queue_line = md.split("Queue:")[1]
    assert "(local)" not in queue_line and "(remote)" not in queue_line


def test_format_done_html_contains_diarization_step_breakdown():
    html = format_done_html(_make_done_event())
    assert "Diarization Step Breakdown" in html
    assert "Provider diarization" in html
    assert "Alignment I/O" in html
    assert "Speaker assignment" in html


def test_format_done_telegram_contains_diarization_step_breakdown():
    md = format_done_telegram(_make_done_event())
    assert "Diarization Step Breakdown" in md
    assert "Provider diarization" in md
    assert "Alignment I/O" in md
    assert "Speaker assignment" in md


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


# --- Duration formatting with unit labels ---


def test_fmt_duration_hours():
    """h:mm:ss format should use unit labels like 1h 30m 00s."""
    assert _fmt_duration(5400) == "1h 30m 00s"


def test_fmt_duration_minutes_only():
    """Durations under 1 hour should omit the hours component."""
    assert _fmt_duration(150) == "2m 30s"


def test_fmt_duration_seconds_only():
    """Very short durations should show 0m Xs."""
    assert _fmt_duration(45) == "0m 45s"


def test_fmt_duration_none():
    assert _fmt_duration(None) == "—"


def test_fmt_duration_zero():
    assert _fmt_duration(0) == "0m 00s"


def test_fmt_short_duration_over_one_hour():
    """Short duration formatter should also use unit labels for >= 1hr."""
    assert _fmt_short_duration(3661.0) == "1h 01m 01s"


def test_fmt_estimate_uses_unit_labels():
    """Queue estimate should use unit labels, not bare h:mm:ss."""
    result = _fmt_estimate(7200.0)
    assert result == "2h 00m 00s"


# --- Average processing stats in notifications ---


def test_format_done_html_contains_averages():
    event = _make_done_event()
    event.avg_transcribe_secs = 130.0
    event.avg_diarize_secs = 65.0
    event.avg_total_secs = 210.0
    html = format_done_html(event)
    assert "Average" in html or "Avg" in html
    assert "2m 10s" in html  # avg transcribe: 130s
    assert "1m 05s" in html  # avg diarize: 65s
    assert "3m 30s" in html  # avg total: 210s


def test_format_done_telegram_contains_averages():
    event = _make_done_event()
    event.avg_transcribe_secs = 130.0
    event.avg_diarize_secs = 65.0
    event.avg_total_secs = 210.0
    md = format_done_telegram(event)
    assert "Avg" in md or "Average" in md
    assert "2m 10s" in md
    assert "1m 05s" in md
    assert "3m 30s" in md


def test_format_done_html_no_averages_when_none():
    """When avg fields are None, averages section should show dash or be absent."""
    event = _make_done_event()
    event.avg_transcribe_secs = None
    event.avg_diarize_secs = None
    event.avg_total_secs = None
    html = format_done_html(event)
    # Should not crash, and should still contain the basic info
    assert "Tech Talk" in html


def test_format_failed_telegram_contains_averages():
    event = _make_failed_event()
    event.avg_transcribe_secs = 130.0
    event.avg_diarize_secs = 65.0
    event.avg_total_secs = 210.0
    md = format_failed_telegram(event)
    assert "Avg" in md or "Average" in md


def test_format_done_html_shows_new_metrics_when_legacy_absent():
    """avg_duration_secs and processing_factor render even when legacy avg fields are None."""
    event = _make_done_event()
    event.avg_transcribe_secs = None
    event.avg_diarize_secs = None
    event.avg_total_secs = None
    event.avg_duration_secs = 2400.0
    event.processing_factor = 1.5
    html = format_done_html(event)
    assert "Avg episode length" in html
    assert "40m 00s" in html  # 2400s
    assert "Avg processing factor" in html
    assert "1.5x" in html


def test_format_done_telegram_shows_new_metrics_when_legacy_absent():
    """avg_duration_secs and processing_factor render even when legacy avg fields are None."""
    event = _make_done_event()
    event.avg_transcribe_secs = None
    event.avg_diarize_secs = None
    event.avg_total_secs = None
    event.avg_duration_secs = 2400.0
    event.processing_factor = 1.5
    md = format_done_telegram(event)
    assert "Avg ep. length" in md
    assert "40m 00s" in md
    assert "Avg processing factor" in md
    assert "1.5x" in md


def test_format_done_html_shows_provider_scoped_label_local():
    event = _make_done_event()
    event.inference_provider_used = "local"
    event.avg_transcribe_secs = 100.0
    html = format_done_html(event)
    assert "Avg Processing Time (local episodes)" in html


def test_format_done_html_shows_provider_scoped_label_remote():
    event = _make_done_event()
    event.inference_provider_used = "fireworks"
    event.avg_transcribe_secs = 100.0
    html = format_done_html(event)
    assert "Avg Processing Time (remote episodes)" in html


def test_format_done_telegram_shows_provider_scoped_label_local():
    event = _make_done_event()
    event.inference_provider_used = "local"
    event.avg_transcribe_secs = 100.0
    md = format_done_telegram(event)
    assert "Avg Processing Time (local episodes)" in md


def test_format_done_html_shows_episode_processing_factor():
    """Per-episode processing factor appears alongside the per-episode times."""
    event = _make_done_event()
    event.episode_processing_factor = 0.3
    html = format_done_html(event)
    assert "Processing factor" in html
    assert "0.3x" in html


def test_format_done_telegram_shows_episode_processing_factor():
    event = _make_done_event()
    event.episode_processing_factor = 1.2
    md = format_done_telegram(event)
    assert "Processing factor" in md
    assert "1.2x" in md
