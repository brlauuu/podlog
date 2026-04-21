"""
Unit tests for RSS feed parsing — PRD-01 §12
"""
import pytest
from unittest.mock import patch, MagicMock

from app.services.rss import (
    validate_and_parse_feed,
    fetch_episodes,
    fetch_feed_and_episodes,
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
      <link>https://example.com/episodes/1</link>
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
            assert episodes[0].episode_url == "https://example.com/episodes/1"
            assert episodes[1].episode_url is None

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


RSS_WITH_AUTHOR_ONLY = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd"
     xmlns:dc="http://purl.org/dc/elements/1.1/">
  <channel>
    <title>Interview Pod</title>
    <link>https://example.com</link>
    <description>Interviews with people</description>
    <itunes:author>Host McHostface</itunes:author>
    <item>
      <title>Ep 1: Jane Smith on AI</title>
      <guid>ep-001</guid>
      <dc:creator>Jane Smith</dc:creator>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
    </item>
  </channel>
</rss>"""

RSS_WITH_OWNER_ONLY = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"
     xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd">
  <channel>
    <title>Owned Pod</title>
    <link>https://example.com</link>
    <description>A show</description>
    <itunes:owner>
      <itunes:name>Owner McOwnerface</itunes:name>
      <itunes:email>owner@example.com</itunes:email>
    </itunes:owner>
    <item>
      <title>Episode 1</title>
      <guid>ep-001</guid>
      <enclosure url="https://example.com/ep1.mp3" type="audio/mpeg" length="12345"/>
    </item>
  </channel>
</rss>"""


class TestRssAuthorTags:
    """PRD-04 B1 + B3: RSS person tags surfaced from the feed.

    Note: feedparser's itunes handler collapses ``<itunes:author>`` into
    ``publisher_detail`` when ``<itunes:owner>`` appears afterwards in the
    channel. These tests keep the two tags in separate fixtures so each
    field's extraction is verified independently.
    """

    def test_itunes_author_extracted(self):
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = RSS_WITH_AUTHOR_ONLY
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            meta = validate_and_parse_feed("https://example.com/feed.xml")
            assert meta.itunes_author == "Host McHostface"
            assert meta.itunes_owner_name is None

    def test_itunes_owner_extracted(self):
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = RSS_WITH_OWNER_ONLY
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            meta = validate_and_parse_feed("https://example.com/feed.xml")
            assert meta.itunes_owner_name == "Owner McOwnerface"

    def test_episode_author_from_dc_creator(self):
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = RSS_WITH_AUTHOR_ONLY
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            episodes = fetch_episodes("https://example.com/feed.xml")
            assert len(episodes) == 1
            assert episodes[0].episode_author == "Jane Smith"

    def test_missing_author_tags_return_none(self):
        """VALID_RSS has no author tags — fields must be None, not empty strings."""
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = VALID_RSS
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            meta = validate_and_parse_feed("https://example.com/feed.xml")
            episodes = fetch_episodes("https://example.com/feed.xml")

            assert meta.itunes_author is None
            assert meta.itunes_owner_name is None
            assert episodes[0].episode_author is None


class TestFetchFeedAndEpisodes:
    def test_returns_feed_and_episodes_in_one_call(self):
        with patch("httpx.get") as mock_get:
            mock_resp = MagicMock()
            mock_resp.text = RSS_WITH_AUTHOR_ONLY
            mock_resp.raise_for_status.return_value = None
            mock_get.return_value = mock_resp

            preview = fetch_feed_and_episodes("https://example.com/feed.xml")

            # Exactly one HTTP fetch for both feed and episode data.
            assert mock_get.call_count == 1
            assert preview.feed.title == "Interview Pod"
            assert preview.feed.itunes_author == "Host McHostface"
            assert len(preview.episodes) == 1
            assert preview.episodes[0].episode_author == "Jane Smith"

    def test_http_error_returns_empty_preview(self):
        """Unlike preview_feed, the poll path must not raise on transient errors."""
        import httpx

        with patch("httpx.get") as mock_get:
            mock_get.side_effect = httpx.ConnectError("Connection refused")
            preview = fetch_feed_and_episodes("https://unreachable.example.com/feed.xml")

            assert preview.episodes == []
            assert preview.feed.title is None
            assert preview.feed.itunes_author is None


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
