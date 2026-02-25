"""
Unit tests for RSS feed parsing — PRD-01 §12
"""
import pytest
from unittest.mock import patch, MagicMock

from app.services.rss import (
    validate_and_parse_feed,
    fetch_episodes,
    InvalidFeedError,
    _parse_duration,
    _parse_date,
)

VALID_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Podcast</title>
    <link>https://example.com</link>
    <description>A test podcast</description>
    <item>
      <title>Episode 1</title>
      <guid>ep-001</guid>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
      <pubDate>Mon, 01 Jan 2024 12:00:00 +0000</pubDate>
      <itunes:duration>01:30:00</itunes:duration>
    </item>
    <item>
      <title>Episode 2</title>
      <guid>ep-002</guid>
      <enclosure url="https://example.com/ep2.mp3" type="audio/mpeg" length="9999"/>
    </item>
  </channel>
</rss>"""

INVALID_HTML = "<html><body><p>Not a feed</p></body></html>"


class TestValidateAndParseFeed:
    def test_valid_rss_returns_meta(self):
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = VALID_RSS
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            meta = validate_and_parse_feed("https://example.com/feed.xml")
            assert meta.title == "Test Podcast"
            assert meta.website_url == "https://example.com"

    def test_http_error_raises_invalid_feed(self):
        import httpx
        with patch("httpx.get") as mock_get:
            mock_get.side_effect = httpx.ConnectError("Connection refused")
            with pytest.raises(InvalidFeedError, match="Could not fetch feed"):
                validate_and_parse_feed("https://unreachable.example.com/feed.xml")

    def test_html_page_raises_invalid_feed(self):
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = INVALID_HTML
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            with pytest.raises(InvalidFeedError):
                validate_and_parse_feed("https://example.com/not-a-feed")


class TestFetchEpisodes:
    def test_returns_episodes_with_audio(self):
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = VALID_RSS
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            episodes = fetch_episodes("https://example.com/feed.xml")
            assert len(episodes) == 2
            assert episodes[0].guid == "ep-001"
            assert episodes[0].audio_url == "https://example.com/ep1.mp3"

    def test_skips_entries_without_audio(self):
        rss = VALID_RSS.replace('<enclosure url="https://example.com/ep2.mp3" type="audio/mpeg" length="9999"/>', "")
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = rss
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            episodes = fetch_episodes("https://example.com/feed.xml")
            # ep-002 has no enclosure, should be excluded
            assert len(episodes) == 1
            assert episodes[0].guid == "ep-001"

    def test_uses_url_as_guid_fallback(self):
        rss = VALID_RSS.replace("<guid>ep-001</guid>", "")
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = rss
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            episodes = fetch_episodes("https://example.com/feed.xml")
            # Should fall back to audio URL as GUID
            assert episodes[0].guid == "https://example.com/ep1.mp3"


class TestParseDuration:
    def test_seconds_only(self):
        assert _parse_duration("3600") == 3600

    def test_mm_ss(self):
        assert _parse_duration("90:30") == 90 * 60 + 30

    def test_hh_mm_ss(self):
        assert _parse_duration("01:30:00") == 3600 + 1800

    def test_invalid_returns_none(self):
        assert _parse_duration("not-a-duration") is None

    def test_none_returns_none(self):
        assert _parse_duration(None) is None
