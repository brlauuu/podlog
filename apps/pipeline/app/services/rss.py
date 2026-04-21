"""
RSS / Atom feed parsing — PRD-01 §5.1, GAP-02

validate_and_parse_feed  — fetch + validate, raise InvalidFeedError if not parseable
fetch_episodes           — return list of episode metadata from a feed URL
preview_feed             — validate + fetch episodes in one HTTP call (used by preview endpoint)
"""
import logging
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from email.utils import parsedate_to_datetime
from urllib.parse import urlparse

import feedparser
import httpx

_ITUNES_NS = "http://www.itunes.com/dtds/podcast-1.0.dtd"

logger = logging.getLogger(__name__)


class InvalidFeedError(Exception):
    """Raised when a URL does not parse as a valid RSS or Atom feed."""


@dataclass
class FeedMeta:
    title: Optional[str]
    description: Optional[str]
    image_url: Optional[str]
    website_url: Optional[str]
    # PRD-04 B1: feedparser normalizes <itunes:author> and <author> to feed.author
    # (use author_detail.name when available to strip "email (Name)" wrappers).
    itunes_author: Optional[str] = None
    # PRD-04 B1: feedparser exposes <itunes:owner><itunes:name>...</itunes:name></itunes:owner>
    # as feed.publisher_detail.name.
    itunes_owner_name: Optional[str] = None


@dataclass
class FeedPreview:
    feed: "FeedMeta"
    episodes: "list[EpisodeMeta]"


@dataclass
class EpisodeMeta:
    guid: str
    title: Optional[str]
    description: Optional[str]
    audio_url: str
    episode_url: Optional[str]
    published_at: Optional[datetime]
    duration_secs: Optional[int]
    # PRD-04 B3: feedparser normalizes <dc:creator>, <itunes:author>, and <author>
    # to entry.author at the episode level. The field is named episode_author
    # rather than dc_creator because the actual XML tag is indistinguishable
    # after feedparser normalization.
    episode_author: Optional[str] = None


def _require_http_url(url: str) -> None:
    """Raise InvalidFeedError if url is not http/https (prevents SSRF via file:// etc.)."""
    scheme = urlparse(url).scheme
    if scheme not in ("http", "https"):
        raise InvalidFeedError(f"Feed URL must use http or https, got: {scheme!r}")


def validate_and_parse_feed(url: str) -> FeedMeta:
    """
    Fetch the URL and attempt to parse it as RSS/Atom (GAP-02).
    Raises InvalidFeedError if:
      - The URL is unreachable
      - The response is not a parseable feed
      - The feed contains no episodes (empty feed is still valid)
    """
    _require_http_url(url)
    try:
        resp = httpx.get(url, follow_redirects=True, timeout=15.0)
        resp.raise_for_status()
        content = resp.text
    except httpx.HTTPError as exc:
        raise InvalidFeedError(f"Could not fetch feed: {exc}") from exc

    parsed = feedparser.parse(content)

    if not parsed.version:
        raise InvalidFeedError(
            "URL does not appear to be a valid RSS or Atom feed"
        )

    if parsed.bozo and not parsed.entries:
        raise InvalidFeedError(
            f"URL does not appear to be a valid RSS or Atom feed: {parsed.bozo_exception}"
        )

    feed = parsed.feed
    return FeedMeta(
        title=feed.get("title"),
        description=feed.get("subtitle") or feed.get("description"),
        image_url=_extract_image(feed),
        website_url=feed.get("link"),
        itunes_author=_extract_feed_author(feed, xml_text=content),
        itunes_owner_name=_extract_feed_owner_name(feed),
    )


def fetch_episodes(url: str) -> list[EpisodeMeta]:
    """Fetch all episodes from an RSS feed URL."""
    try:
        resp = httpx.get(url, follow_redirects=True, timeout=15.0)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error('"action": "feed_fetch_error", "url": "%s", "error": "%s"', url, exc)
        return []

    parsed = feedparser.parse(resp.text)
    episodes = []

    for entry in parsed.entries:
        audio_url = _extract_audio_url(entry)
        if not audio_url:
            continue

        guid = entry.get("id") or audio_url
        published_at = _parse_date(entry.get("published"))
        duration_secs = _parse_duration(entry.get("itunes_duration"))

        raw_link = entry.get("link") or ""
        episode_url = raw_link if raw_link.startswith(("http://", "https://")) else None

        episodes.append(
            EpisodeMeta(
                guid=guid,
                title=entry.get("title"),
                description=entry.get("summary"),
                audio_url=audio_url,
                episode_url=episode_url,
                published_at=published_at,
                duration_secs=duration_secs,
                episode_author=_extract_entry_author(entry),
            )
        )

    return episodes


def fetch_feed_and_episodes(url: str) -> FeedPreview:
    """Fetch a feed once and return both feed metadata and episodes.

    Same single-HTTP-call shape as preview_feed, but used by the pipeline
    poll path so feed-level metadata (e.g. itunes_author) gets refreshed
    alongside episode ingestion. Unlike preview_feed, this does not raise
    on transient fetch failures — it logs and returns an empty result so
    the periodic poller keeps going.
    """
    _require_http_url(url)
    try:
        resp = httpx.get(url, follow_redirects=True, timeout=15.0)
        resp.raise_for_status()
    except httpx.HTTPError as exc:
        logger.error('"action": "feed_fetch_error", "url": "%s", "error": "%s"', url, exc)
        return FeedPreview(
            feed=FeedMeta(title=None, description=None, image_url=None, website_url=None),
            episodes=[],
        )

    parsed = feedparser.parse(resp.text)
    feed_data = parsed.feed
    feed_meta = FeedMeta(
        title=feed_data.get("title"),
        description=feed_data.get("subtitle") or feed_data.get("description"),
        image_url=_extract_image(feed_data),
        website_url=feed_data.get("link"),
        itunes_author=_extract_feed_author(feed_data, xml_text=resp.text),
        itunes_owner_name=_extract_feed_owner_name(feed_data),
    )

    episodes = []
    for entry in parsed.entries:
        audio_url = _extract_audio_url(entry)
        if not audio_url:
            continue
        guid = entry.get("id") or audio_url
        raw_link = entry.get("link") or ""
        episodes.append(
            EpisodeMeta(
                guid=guid,
                title=entry.get("title"),
                description=entry.get("summary"),
                audio_url=audio_url,
                episode_url=raw_link if raw_link.startswith(("http://", "https://")) else None,
                published_at=_parse_date(entry.get("published")),
                duration_secs=_parse_duration(entry.get("itunes_duration")),
                episode_author=_extract_entry_author(entry),
            )
        )

    return FeedPreview(feed=feed_meta, episodes=episodes)


def preview_feed(url: str) -> FeedPreview:
    """
    Fetch a feed URL once and return both feed metadata and episode list.
    Used by the preview endpoint (issue #84) to avoid a double HTTP call.
    Raises InvalidFeedError if the URL is unreachable or not a valid feed.
    """
    _require_http_url(url)
    try:
        resp = httpx.get(url, follow_redirects=True, timeout=15.0)
        resp.raise_for_status()
        content = resp.text
    except httpx.HTTPError as exc:
        raise InvalidFeedError(f"Could not fetch feed: {exc}") from exc

    parsed = feedparser.parse(content)

    if not parsed.version:
        raise InvalidFeedError("URL does not appear to be a valid RSS or Atom feed")

    if parsed.bozo and not parsed.entries:
        raise InvalidFeedError(
            f"URL does not appear to be a valid RSS or Atom feed: {parsed.bozo_exception}"
        )

    feed_data = parsed.feed
    feed_meta = FeedMeta(
        title=feed_data.get("title"),
        description=feed_data.get("subtitle") or feed_data.get("description"),
        image_url=_extract_image(feed_data),
        website_url=feed_data.get("link"),
        itunes_author=_extract_feed_author(feed_data, xml_text=content),
        itunes_owner_name=_extract_feed_owner_name(feed_data),
    )

    episodes = []
    for entry in parsed.entries:
        audio_url = _extract_audio_url(entry)
        if not audio_url:
            continue
        guid = entry.get("id") or audio_url
        raw_link = entry.get("link") or ""
        episodes.append(
            EpisodeMeta(
                guid=guid,
                title=entry.get("title"),
                description=entry.get("summary"),
                audio_url=audio_url,
                episode_url=raw_link if raw_link.startswith(("http://", "https://")) else None,
                published_at=_parse_date(entry.get("published")),
                duration_secs=_parse_duration(entry.get("itunes_duration")),
                episode_author=_extract_entry_author(entry),
            )
        )

    return FeedPreview(feed=feed_meta, episodes=episodes)


def _extract_audio_url(entry: dict) -> Optional[str]:
    for link in entry.get("enclosures", []):
        mime = link.get("type", "")
        if mime.startswith("audio/") or mime == "":
            return link.get("href") or link.get("url")
    # Fallback: look for audio link in links list
    for link in entry.get("links", []):
        if link.get("type", "").startswith("audio/"):
            return link.get("href")
    return None


def _extract_image(feed: dict) -> Optional[str]:
    if feed.get("image"):
        return feed["image"].get("href") or feed["image"].get("url")
    return None


def _parse_date(date_str: Optional[str]) -> Optional[datetime]:
    if not date_str:
        return None
    try:
        return parsedate_to_datetime(date_str).astimezone(timezone.utc)
    except Exception:
        return None


def _extract_itunes_author_from_xml(xml_text: Optional[str]) -> Optional[str]:
    """Read <itunes:author> directly from the channel element (PRD-04 B1).

    Works around a feedparser quirk: when <itunes:owner> appears after
    <itunes:author> in the channel, feedparser overwrites author_detail with
    the owner's name, silently losing the author. We read the raw XML to
    recover the true author tag. Returns None on any parse failure.
    """
    if not xml_text:
        return None
    try:
        root = ET.fromstring(xml_text)
    except ET.ParseError:
        return None
    channel = root.find("channel")
    if channel is None:
        return None
    # Only the channel-level <itunes:author>, not item-level ones.
    node = channel.find(f"{{{_ITUNES_NS}}}author")
    if node is None or not node.text:
        return None
    return node.text.strip() or None


def _extract_feed_author(feed: dict, xml_text: Optional[str] = None) -> Optional[str]:
    """Extract <itunes:author> / <author> at the channel level (PRD-04 B1).

    When the raw feed XML is supplied, a direct namespace-aware lookup takes
    precedence over feedparser's author_detail — feedparser collapses
    <itunes:author> into publisher_detail when <itunes:owner> follows it in
    the channel, dropping the on-air author name. Fall back to feedparser's
    author_detail.name (which strips 'email (Name)' wrappers) and finally to
    the raw `author` string.
    """
    raw_xml = _extract_itunes_author_from_xml(xml_text)
    if raw_xml:
        return raw_xml
    detail = feed.get("author_detail") or {}
    name = detail.get("name") if isinstance(detail, dict) else None
    if name:
        return name.strip() or None
    raw = feed.get("author")
    return raw.strip() if raw else None


def _extract_feed_owner_name(feed: dict) -> Optional[str]:
    """Extract <itunes:owner><itunes:name>...</itunes:name></itunes:owner> (PRD-04 B1).

    feedparser surfaces this as feed.publisher_detail.name.
    """
    detail = feed.get("publisher_detail") or {}
    name = detail.get("name") if isinstance(detail, dict) else None
    return name.strip() if name else None


def _extract_entry_author(entry: dict) -> Optional[str]:
    """Extract episode-level author (PRD-04 B3).

    feedparser normalizes <dc:creator>, <itunes:author>, and <author> at the
    <item> level into entry.author; author_detail.name is the cleaned name.
    """
    detail = entry.get("author_detail") or {}
    name = detail.get("name") if isinstance(detail, dict) else None
    if name:
        return name.strip() or None
    raw = entry.get("author")
    return raw.strip() if raw else None


def _parse_duration(duration_str: Optional[str]) -> Optional[int]:
    if not duration_str:
        return None
    try:
        parts = str(duration_str).split(":")
        if len(parts) == 1:
            return int(parts[0])
        elif len(parts) == 2:
            return int(parts[0]) * 60 + int(parts[1])
        elif len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + int(parts[2])
    except (ValueError, IndexError):
        pass
    return None
