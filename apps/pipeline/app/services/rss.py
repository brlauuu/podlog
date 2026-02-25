"""
RSS / Atom feed parsing — PRD-01 §5.1, GAP-02

validate_and_parse_feed  — fetch + validate, raise InvalidFeedError if not parseable
fetch_episodes           — return list of episode metadata from a feed URL
"""
import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Optional
from email.utils import parsedate_to_datetime

import feedparser
import httpx

logger = logging.getLogger(__name__)


class InvalidFeedError(Exception):
    """Raised when a URL does not parse as a valid RSS or Atom feed."""


@dataclass
class FeedMeta:
    title: Optional[str]
    description: Optional[str]
    image_url: Optional[str]
    website_url: Optional[str]


@dataclass
class EpisodeMeta:
    guid: str
    title: Optional[str]
    description: Optional[str]
    audio_url: str
    published_at: Optional[datetime]
    duration_secs: Optional[int]


def validate_and_parse_feed(url: str) -> FeedMeta:
    """
    Fetch the URL and attempt to parse it as RSS/Atom (GAP-02).
    Raises InvalidFeedError if:
      - The URL is unreachable
      - The response is not a parseable feed
      - The feed contains no episodes (empty feed is still valid)
    """
    try:
        resp = httpx.get(url, follow_redirects=True, timeout=15.0)
        resp.raise_for_status()
        content = resp.text
    except httpx.HTTPError as exc:
        raise InvalidFeedError(f"Could not fetch feed: {exc}") from exc

    parsed = feedparser.parse(content)

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

        episodes.append(
            EpisodeMeta(
                guid=guid,
                title=entry.get("title"),
                description=entry.get("summary"),
                audio_url=audio_url,
                published_at=published_at,
                duration_secs=duration_secs,
            )
        )

    return episodes


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
