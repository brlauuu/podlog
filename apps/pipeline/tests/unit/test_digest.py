"""Tests for notification digest — event logging and digest scheduling."""
import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch, call

from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent
from app.services.digest import log_event


def _make_done_event() -> EpisodeDoneEvent:
    return EpisodeDoneEvent(
        episode_id="ep1",
        episode_title="Test Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.0,
        diarize_duration_secs=60.0,
        total_duration_secs=200.0,
        queue_remaining=5,
        queue_estimated_secs=1000.0,
    )


def _make_failed_event() -> EpisodeFailedEvent:
    return EpisodeFailedEvent(
        episode_id="ep2",
        episode_title="Bad Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 3, 15, tzinfo=timezone.utc),
        duration_secs=1800,
        error_class="OOM",
        error_message="Out of memory",
        retry_count=3,
        retry_max=3,
        queue_remaining=2,
        queue_estimated_secs=500.0,
    )


@patch("app.services.digest.SessionLocal")
def test_log_event_inserts_done_event(mock_session_cls):
    db = MagicMock()
    mock_session_cls.return_value = db

    event = _make_done_event()
    log_event(event)

    db.add.assert_called_once()
    log_row = db.add.call_args[0][0]
    assert log_row.event_type == "episode.done"
    assert log_row.episode_id == "ep1"
    assert log_row.sent is False
    payload = json.loads(log_row.payload)
    assert payload["episode_title"] == "Test Ep"
    db.commit.assert_called_once()
    db.close.assert_called_once()


@patch("app.services.digest.SessionLocal")
def test_log_event_inserts_failed_event_as_sent(mock_session_cls):
    db = MagicMock()
    mock_session_cls.return_value = db

    event = _make_failed_event()
    log_event(event, mark_sent=True)

    log_row = db.add.call_args[0][0]
    assert log_row.event_type == "episode.failed"
    assert log_row.episode_id == "ep2"
    assert log_row.sent is True
    db.commit.assert_called_once()


from app.services.digest import is_digest_due


def test_digest_not_due_in_immediate_mode():
    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("immediate", now, last_sent=None) is False


def test_daily_digest_due_after_8am_never_sent():
    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=None) is True


def test_daily_digest_not_due_before_8am():
    now = datetime(2026, 3, 15, 7, 59, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=None) is False


def test_daily_digest_not_due_if_already_sent_today():
    now = datetime(2026, 3, 15, 10, 0, tzinfo=timezone.utc)
    last = datetime(2026, 3, 15, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=last) is False


def test_daily_digest_due_next_day():
    now = datetime(2026, 3, 16, 8, 30, tzinfo=timezone.utc)
    last = datetime(2026, 3, 15, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("daily", now, last_sent=last) is True


def test_weekly_digest_due_on_monday_after_8am():
    # March 16, 2026 is a Monday
    now = datetime(2026, 3, 16, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=None) is True


def test_weekly_digest_not_due_on_tuesday():
    # March 17, 2026 is a Tuesday — never fires on non-Monday even if never sent
    now = datetime(2026, 3, 17, 8, 30, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=None) is False


def test_weekly_digest_not_due_on_monday_before_8am():
    now = datetime(2026, 3, 16, 7, 0, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=None) is False


def test_weekly_digest_due_next_monday():
    now = datetime(2026, 3, 23, 9, 0, tzinfo=timezone.utc)  # next Monday
    last = datetime(2026, 3, 16, 8, 1, tzinfo=timezone.utc)
    assert is_digest_due("weekly", now, last_sent=last) is True


from app.services.digest import send_digest_if_due, DigestItem


@patch("app.services.digest.SessionLocal")
@patch("smtplib.SMTP")
@patch("app.services.digest.compute_avg_duration", return_value=1800.0)
@patch("app.services.digest.estimate_queue_status", return_value=(3, 900.0, 0.5))
@patch("app.services.digest.get_notification_settings")
def test_send_digest_sends_when_due(mock_get_ns, mock_estimate, mock_avg_dur, mock_smtp_cls, mock_session_cls):
    mock_get_ns.return_value = {
        "notification_frequency": "daily",
        "email_configured": True,
        "telegram_configured": False,
        "notification_email_to": "user@example.com",
        "notification_email_from": "podlog@localhost",
        "smtp_host": "localhost",
        "smtp_port": 25,
        "smtp_user": None,
        "smtp_password": None,
        "smtp_use_tls": False,
    }

    db = MagicMock()
    mock_session_cls.return_value = db

    # Mock system_state: never sent
    db.query.return_value.filter.return_value.first.side_effect = [
        None,  # system_state lookup returns None (never sent)
    ]

    # Mock unsent notification_log rows
    log_row = MagicMock()
    log_row.id = 1
    log_row.event_type = "episode.done"
    log_row.payload = json.dumps({
        "episode_id": "ep1",
        "episode_title": "Test Ep",
        "podcast_title": "Pod",
        "published_at": "2026-03-15T00:00:00+00:00",
        "duration_secs": 3600,
        "transcribe_duration_secs": 120.0,
        "diarize_duration_secs": 60.0,
        "total_duration_secs": 200.0,
        "queue_remaining": 0,
        "queue_estimated_secs": None,
    })
    log_row.sent = False
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [log_row]

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    # Verify SMTP was used
    mock_smtp_cls.assert_called_once_with("localhost", 25)
    mock_smtp_cls.return_value.__enter__.return_value.send_message.assert_called_once()

    # Verify rows were marked as sent
    assert log_row.sent is True


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest.get_notification_settings")
def test_send_digest_skips_when_not_due(mock_get_ns, mock_session_cls):
    mock_get_ns.return_value = {"notification_frequency": "daily"}

    db = MagicMock()
    mock_session_cls.return_value = db

    # 7am — before digest hour
    now = datetime(2026, 3, 15, 7, 0, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    db.close.assert_called()


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest.get_notification_settings")
def test_send_digest_skips_immediate_mode(mock_get_ns, mock_session_cls):
    mock_get_ns.return_value = {"notification_frequency": "immediate"}

    db = MagicMock()
    mock_session_cls.return_value = db

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest.estimate_queue_status", return_value=(0, None, None))
@patch("app.services.digest.get_notification_settings")
def test_send_digest_skips_when_no_unsent_events(mock_get_ns, mock_estimate, mock_session_cls):
    mock_get_ns.return_value = {"notification_frequency": "daily"}

    db = MagicMock()
    mock_session_cls.return_value = db

    # Never sent before
    db.query.return_value.filter.return_value.first.return_value = None
    # No unsent rows
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = []

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)


from app.services.digest import (
    DigestData,
    DigestItem,
    ProviderAverages,
    format_digest_html,
    format_digest_telegram,
)


def test_digest_html_shows_new_metrics_when_legacy_absent():
    """avg_duration_secs and processing_factor render in digest even without legacy avg fields."""
    data = DigestData(
        frequency="daily",
        date_label="Apr 06, 2026",
        items=[],
        avg_transcribe_secs=None,
        avg_diarize_secs=None,
        avg_total_secs=None,
        avg_duration_secs=2400.0,
        processing_factor=1.5,
    )
    html = format_digest_html(data)
    assert "Avg episode length" in html
    assert "40m 00s" in html
    assert "Avg processing factor" in html
    assert "1.5x" in html


def test_digest_telegram_shows_new_metrics_when_legacy_absent():
    """avg_duration_secs and processing_factor render in digest telegram even without legacy avg fields."""
    data = DigestData(
        frequency="daily",
        date_label="Apr 06, 2026",
        items=[],
        avg_transcribe_secs=None,
        avg_diarize_secs=None,
        avg_total_secs=None,
        avg_duration_secs=2400.0,
        processing_factor=1.5,
    )
    md = format_digest_telegram(data)
    assert "Avg ep. length" in md
    assert "40m 00s" in md
    assert "Avg processing factor" in md
    assert "1.5x" in md

@patch("app.services.digest.SessionLocal")
@patch("app.services.digest._send_digest")
@patch("app.services.digest.compute_avg_duration", return_value=None)
@patch("app.services.digest.compute_avg_processing_stats", return_value=(None, None, None))
@patch("app.services.digest.estimate_queue_status", return_value=(0, None, None))
@patch("app.services.digest.get_notification_settings")
def test_send_digest_maps_diarize_step_durations(
    mock_get_ns,
    mock_estimate,
    mock_avg_stats,
    mock_avg_dur,
    mock_send_digest,
    mock_session_cls,
):
    mock_get_ns.return_value = {
        "notification_frequency": "daily",
        "email_configured": False,
        "telegram_configured": False,
    }

    db = MagicMock()
    mock_session_cls.return_value = db

    db.query.return_value.filter.return_value.first.return_value = None

    log_row = MagicMock()
    log_row.event_type = "episode.done"
    log_row.payload = json.dumps({
        "episode_title": "Test Ep",
        "podcast_title": "Pod",
        "duration_secs": 3600,
        "total_duration_secs": 200.0,
        "diarize_step_durations": {
            "provider_diarization_secs": 42.0,
            "speaker_assignment_secs": 13.0,
        },
    })
    log_row.sent = False
    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [log_row]

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    digest = mock_send_digest.call_args[0][0]
    assert len(digest.items) == 1
    assert digest.items[0].diarize_step_durations == {
        "provider_diarization_secs": 42.0,
        "speaker_assignment_secs": 13.0,
    }


def test_digest_html_renders_per_provider_averages():
    """When provider_averages is populated, digest renders one table per provider."""
    data = DigestData(
        frequency="daily",
        date_label="Apr 06, 2026",
        items=[],
        provider_averages=[
            ProviderAverages(
                provider="local",
                avg_transcribe_secs=600.0,
                avg_diarize_secs=300.0,
                avg_total_secs=900.0,
                avg_duration_secs=1800.0,
                processing_factor=0.5,
            ),
            ProviderAverages(
                provider="fireworks",
                avg_transcribe_secs=60.0,
                avg_diarize_secs=30.0,
                avg_total_secs=90.0,
                avg_duration_secs=1800.0,
                processing_factor=0.05,
            ),
        ],
    )
    html = format_digest_html(data)
    assert "Avg Processing Time (local episodes)" in html
    assert "Avg Processing Time (remote episodes)" in html
    assert "0.5x" in html
    assert "0.1x" in html  # 0.05 rounds to 0.1x in _fmt_factor


def test_digest_telegram_renders_per_provider_averages():
    data = DigestData(
        frequency="daily",
        date_label="Apr 06, 2026",
        items=[],
        provider_averages=[
            ProviderAverages(
                provider="local",
                avg_transcribe_secs=600.0,
                avg_total_secs=900.0,
                processing_factor=0.5,
            ),
            ProviderAverages(
                provider="fireworks",
                avg_transcribe_secs=60.0,
                avg_total_secs=90.0,
                processing_factor=0.05,
            ),
        ],
    )
    md = format_digest_telegram(data)
    assert "Avg Processing Time (local episodes)" in md
    assert "Avg Processing Time (remote episodes)" in md


def test_digest_html_renders_per_item_processing_factor():
    """Done items include the per-episode processing factor next to the detail text."""
    data = DigestData(
        frequency="daily",
        date_label="Apr 06, 2026",
        items=[
            DigestItem(
                event_type="episode.done",
                episode_title="Ep1",
                podcast_title="Pod",
                duration_secs=1800,
                total_duration_secs=900.0,
                error_class=None,
                retry_count=None,
                retry_max=None,
                inference_provider_used="local",
                episode_processing_factor=0.5,
            ),
        ],
    )
    html = format_digest_html(data)
    assert "0.5x" in html


@patch("app.services.digest.SessionLocal")
@patch("app.services.digest._send_digest")
@patch("app.services.digest.compute_avg_duration", return_value=None)
@patch("app.services.digest.compute_avg_processing_stats", return_value=(None, None, None))
@patch("app.services.digest.compute_avg_processing_factor", return_value=0.5)
@patch("app.services.digest.estimate_queue_status", return_value=(0, None, None))
@patch("app.services.digest.get_notification_settings")
def test_send_digest_builds_per_provider_averages(
    mock_get_ns,
    mock_estimate,
    mock_avg_factor,
    mock_avg_stats,
    mock_avg_dur,
    mock_send_digest,
    mock_session_cls,
):
    mock_get_ns.return_value = {
        "notification_frequency": "daily",
        "email_configured": False,
        "telegram_configured": False,
    }
    db = MagicMock()
    mock_session_cls.return_value = db
    db.query.return_value.filter.return_value.first.return_value = None

    # Two events: one local, one fireworks — digest should compute a ProviderAverages
    # entry for each provider.
    row_local = MagicMock()
    row_local.event_type = "episode.done"
    row_local.payload = json.dumps({
        "episode_title": "Local Ep",
        "podcast_title": "Pod",
        "duration_secs": 1800,
        "total_duration_secs": 900.0,
        "inference_provider_used": "local",
        "episode_processing_factor": 0.5,
    })
    row_local.sent = False

    row_remote = MagicMock()
    row_remote.event_type = "episode.done"
    row_remote.payload = json.dumps({
        "episode_title": "Remote Ep",
        "podcast_title": "Pod",
        "duration_secs": 1800,
        "total_duration_secs": 90.0,
        "inference_provider_used": "fireworks",
        "episode_processing_factor": 0.05,
    })
    row_remote.sent = False

    db.query.return_value.filter.return_value.order_by.return_value.all.return_value = [
        row_local, row_remote
    ]

    # compute_avg_processing_stats returns (None, None, None) → provider_averages
    # entries will be dropped because every field is None. Override with non-None
    # stats so the entries survive.
    mock_avg_stats.return_value = (100.0, 50.0, 150.0)

    now = datetime(2026, 3, 15, 8, 30, tzinfo=timezone.utc)
    send_digest_if_due(now=now)

    digest = mock_send_digest.call_args[0][0]
    assert [pa.provider for pa in digest.provider_averages] == ["local", "fireworks"]
    # Per-item provider + per-episode factor are carried through.
    assert digest.items[0].inference_provider_used == "local"
    assert digest.items[0].episode_processing_factor == 0.5
    assert digest.items[1].inference_provider_used == "fireworks"
    assert digest.items[1].episode_processing_factor == 0.05
