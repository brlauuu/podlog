"""Tests for notification frequency config."""

import pytest


def test_notification_frequency_defaults_to_immediate():
    from app.config import Settings
    s = Settings(database_url="postgresql://x", hf_token="t")
    assert s.notification_frequency == "immediate"


def test_notification_frequency_accepts_daily():
    from app.config import Settings
    s = Settings(database_url="postgresql://x", hf_token="t", notification_frequency="daily")
    assert s.notification_frequency == "daily"


def test_notification_frequency_accepts_weekly():
    from app.config import Settings
    s = Settings(database_url="postgresql://x", hf_token="t", notification_frequency="weekly")
    assert s.notification_frequency == "weekly"


def test_notification_frequency_rejects_invalid():
    from app.config import Settings
    with pytest.raises(Exception):
        Settings(database_url="postgresql://x", hf_token="t", notification_frequency="hourly")
