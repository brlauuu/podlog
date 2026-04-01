"""Tests for the email notification handler."""
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent, send_email


def _make_done_event() -> EpisodeDoneEvent:
    return EpisodeDoneEvent(
        episode_id="abc",
        episode_title="Test Ep",
        podcast_title="Test Pod",
        published_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        duration_secs=3600,
        transcribe_duration_secs=120.0,
        diarize_duration_secs=60.0,
        total_duration_secs=200.0,
        queue_remaining=3,
        queue_estimated_secs=900.0,
    )


@patch("app.services.notifications.smtplib")
def test_send_email_done_event(mock_smtplib):
    mock_smtp = MagicMock()
    mock_smtplib.SMTP.return_value.__enter__ = MagicMock(return_value=mock_smtp)
    mock_smtplib.SMTP.return_value.__exit__ = MagicMock(return_value=False)

    send_email(
        _make_done_event(),
        to_addr="user@example.com",
        from_addr="podlog@localhost",
        smtp_host="localhost",
        smtp_port=25,
    )

    mock_smtp.send_message.assert_called_once()
    msg = mock_smtp.send_message.call_args[0][0]
    assert msg["To"] == "user@example.com"
    assert msg["From"] == "podlog@localhost"
    assert "Test Ep" in msg["Subject"]


@patch("app.services.notifications.smtplib")
def test_send_email_with_tls_and_auth(mock_smtplib):
    mock_smtp = MagicMock()
    mock_smtplib.SMTP.return_value.__enter__ = MagicMock(return_value=mock_smtp)
    mock_smtplib.SMTP.return_value.__exit__ = MagicMock(return_value=False)

    send_email(
        _make_done_event(),
        to_addr="user@example.com",
        from_addr="podlog@localhost",
        smtp_host="smtp.gmail.com",
        smtp_port=587,
        smtp_user="user",
        smtp_password="pass",
        use_tls=True,
    )

    mock_smtp.starttls.assert_called_once()
    mock_smtp.login.assert_called_once_with("user", "pass")


@patch("app.services.notifications.smtplib")
def test_send_email_failed_event(mock_smtplib):
    mock_smtp = MagicMock()
    mock_smtplib.SMTP.return_value.__enter__ = MagicMock(return_value=mock_smtp)
    mock_smtplib.SMTP.return_value.__exit__ = MagicMock(return_value=False)

    event = EpisodeFailedEvent(
        episode_id="abc",
        episode_title="Bad Ep",
        podcast_title="Test Pod",
        error_class="OOM",
        error_message="Out of memory",
        retry_count=3,
        retry_max=3,
        queue_remaining=0,
        queue_estimated_secs=None,
    )

    send_email(
        event,
        to_addr="user@example.com",
        from_addr="podlog@localhost",
        smtp_host="localhost",
        smtp_port=25,
    )

    msg = mock_smtp.send_message.call_args[0][0]
    assert "Failed" in msg["Subject"] or "failed" in msg["Subject"].lower()
