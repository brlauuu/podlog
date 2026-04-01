# apps/pipeline/tests/unit/test_digest_wiring.py
"""Tests for notification handler registration based on frequency setting."""
from unittest.mock import MagicMock, patch, call

from app.services.events import EventBus
from app.services.notifications import EpisodeDoneEvent, EpisodeFailedEvent


def test_immediate_mode_subscribes_send_directly():
    """In immediate mode, both event types get direct send handlers."""
    bus = EventBus()

    with patch("app.services.digest.settings") as mock_settings:
        mock_settings.notification_frequency = "immediate"
        mock_settings.email_notifications_enabled = True
        mock_settings.telegram_notifications_enabled = False

        from app.services.digest import register_notification_handlers
        register_notification_handlers(bus)

    # Should have handlers for both event types
    assert len(bus._handlers[EpisodeDoneEvent]) == 1
    assert len(bus._handlers[EpisodeFailedEvent]) == 1


def test_daily_mode_logs_done_sends_failed():
    """In daily mode, done events get log handler, failed events get both log and send."""
    bus = EventBus()

    with patch("app.services.digest.settings") as mock_settings:
        mock_settings.notification_frequency = "daily"
        mock_settings.email_notifications_enabled = True
        mock_settings.telegram_notifications_enabled = False
        mock_settings.notification_email_to = "user@example.com"
        mock_settings.notification_email_from = "podlog@localhost"
        mock_settings.smtp_host = "localhost"
        mock_settings.smtp_port = 25
        mock_settings.smtp_user = None
        mock_settings.smtp_password = None
        mock_settings.smtp_use_tls = False

        from app.services.digest import register_notification_handlers
        register_notification_handlers(bus)

    # Done events: 1 handler (log_event)
    assert len(bus._handlers[EpisodeDoneEvent]) == 1
    # Failed events: 2 handlers (log_event + send_email)
    assert len(bus._handlers[EpisodeFailedEvent]) == 2


def test_no_handlers_when_no_channels_enabled():
    """No handlers registered if neither email nor telegram is configured."""
    bus = EventBus()

    with patch("app.services.digest.settings") as mock_settings:
        mock_settings.notification_frequency = "immediate"
        mock_settings.email_notifications_enabled = False
        mock_settings.telegram_notifications_enabled = False

        from app.services.digest import register_notification_handlers
        register_notification_handlers(bus)

    assert len(bus._handlers[EpisodeDoneEvent]) == 0
    assert len(bus._handlers[EpisodeFailedEvent]) == 0
