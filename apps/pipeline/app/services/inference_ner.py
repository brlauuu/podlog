"""NER / RSS-metadata candidate extraction for the inference pipeline (PRD-04).

Covers two input pathways that both produce `CandidateName` lists:

1. spaCy NER over the episode + feed free-text sources
   (extract_candidates).
2. Pre-classified RSS metadata (itunes tags, <podcast:person>, the
   recurring-host observation, and the per-feed user-confirmation
   cache) (extract_metadata_candidates).

These feed into merge_candidates + classify_candidates in
inference_classify. Split out so the role/confidence reconciliation
rules live in one place and extraction stays free of them.
"""
import logging
import re
from typing import Optional

from app.services.inference_helpers import (
    normalize_name,
    strip_episode_prefix,
    strip_html,
)
from app.services.inference_types import CandidateName

# Slot label the per-feed cache uses for "this name was the host on prior
# episodes" entries. Cache entries against any other slot are recurring
# guests / producers / one-off guests, and #703 PR 3 gates those on
# this-episode corroboration before seeding them as candidates.
_HOST_SLOT_LABEL = "SPEAKER_00"

logger = logging.getLogger(__name__)


# <podcast:person> role values that map to host/guest. Everything else is
# dropped rather than guessed — the Podcasting 2.0 role vocabulary is large
# (narrator, camera, editor, etc.) and most of it is production crew, not
# speakers in the audio. Roles here are drawn from the Podcast Namespace
# group="cast" taxonomy.
_PODCAST_HOST_ROLES = frozenset(
    {"host", "cohost", "co-host", "guest host", "presenter", "interviewer"}
)
_PODCAST_GUEST_ROLES = frozenset({"guest", "interviewee", "subject"})


_ORG_SUFFIX_RE = re.compile(
    r"\b(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Co\.?|Ltd\.?|GmbH|SA|AG|Media|Network|"
    r"Networks|Productions|Studios?|Podcasts?|Radio|Group|Company|Communications)\b",
    re.IGNORECASE,
)


def extract_candidates(
    nlp,
    episode_description: Optional[str],
    feed_title: Optional[str],
    feed_description: Optional[str],
    episode_title: Optional[str] = None,
) -> list[CandidateName]:
    """Extract PERSON entities from all available text sources.

    episode_title is processed through strip_episode_prefix (PRD-04 E2) so
    patterns like "Ep 42: Jane Smith" don't confuse the NER model.
    """
    candidates: list[CandidateName] = []
    seen_normalized: set[str] = set()

    # Episode title is run through E2 preprocessing; other sources are
    # passed verbatim (after HTML stripping).
    title_for_ner = strip_episode_prefix(episode_title) if episode_title else None

    sources = [
        (episode_description, "episode_description"),
        (title_for_ner, "episode_title"),
        (feed_title, "feed_title"),
        (feed_description, "feed_description"),
    ]

    for text, source_name in sources:
        if not text:
            continue
        clean = strip_html(text)
        doc = nlp(clean)
        for ent in doc.ents:
            if ent.label_ != "PERSON":
                continue
            norm = normalize_name(ent.text)
            if norm in seen_normalized:
                continue
            seen_normalized.add(norm)
            candidates.append(CandidateName(name=ent.text.strip(), source=source_name))

    return candidates


def _looks_like_person_name(name: str) -> bool:
    """Return False for strings that almost certainly name an organization.

    Metadata sources (especially <itunes:owner>) often carry company or
    network names. We only want to seed host candidates with plausible
    person names. Heuristic — not NER — so false negatives are preferred
    over false positives; an ambiguous string still goes to NER via the
    episode description.
    """
    stripped = name.strip()
    if not stripped:
        return False
    if _ORG_SUFFIX_RE.search(stripped):
        return False
    tokens = stripped.split()
    # One-token or 5+ token strings are rarely on-air host names.
    return 2 <= len(tokens) <= 4


def _podcast_person_to_candidate(
    entry: dict,
    source: str,
) -> Optional[CandidateName]:
    """Turn one <podcast:person> dict into a CandidateName, or None to skip.

    Role mapping (PRD-04 B2):
      - host-like roles (host, cohost, presenter) → host HIGH
      - guest-like roles (guest, interviewee)     → guest HIGH
      - everything else (crew, narrator, editor, etc.) is dropped — those
        roles are almost always production staff who don't appear in audio.

    Episode-level tags outrank channel-level tags by carrying HIGH
    confidence; the caller controls ordering via `source`. Non-string or
    non-person strings (ACME Media LLC, single tokens) are dropped.
    """
    if not isinstance(entry, dict):
        return None
    name = (entry.get("name") or "").strip()
    if not name or not _looks_like_person_name(name):
        return None
    # Defensive re-normalize in case the dict came from a source that did
    # not run rss._parse_podcast_persons_from_element (e.g. unit tests).
    # Empty/whitespace role defaults to "host" per Podcasting 2.0 spec.
    role_raw = (entry.get("role") or "").strip().lower() or "host"
    if role_raw in _PODCAST_HOST_ROLES:
        role = "host"
    elif role_raw in _PODCAST_GUEST_ROLES:
        role = "guest"
    else:
        return None
    return CandidateName(name=name, source=source, role=role, confidence="HIGH")


def _build_corroboration_haystack(
    episode_title: Optional[str],
    episode_description: Optional[str],
    episode_podcast_persons: Optional[list[dict]] = None,
) -> str:
    """Build a single lowercased text blob that recurring-guest cache
    entries are checked against (#703 PR 3). Includes the episode
    title, the HTML-stripped description, and the names from any
    episode-level <podcast:person> tags.

    Returns an empty string if nothing is available — in which case
    nothing corroborates and all SPEAKER_NN cache entries are skipped.
    """
    pieces: list[str] = []
    if episode_title:
        pieces.append(episode_title)
    if episode_description:
        pieces.append(strip_html(episode_description))
    for entry in episode_podcast_persons or []:
        if not isinstance(entry, dict):
            continue
        name = (entry.get("name") or "").strip()
        if name:
            pieces.append(name)
    return " ".join(pieces).lower()


def _is_corroborated_in_episode(name: str, haystack_lower: str) -> bool:
    """True when the normalized name appears as a substring in the
    pre-lowercased episode text blob."""
    if not haystack_lower:
        return False
    norm = normalize_name(name)
    if not norm:
        return False
    return norm in haystack_lower


def extract_metadata_candidates(
    itunes_author: Optional[str],
    itunes_owner_name: Optional[str],
    episode_author: Optional[str],
    feed_podcast_persons: Optional[list[dict]] = None,
    episode_podcast_persons: Optional[list[dict]] = None,
    recurring_host_name: Optional[str] = None,
    feed_speaker_cache_priors: Optional[list[dict]] = None,
    episode_title: Optional[str] = None,
    episode_description: Optional[str] = None,
) -> list[CandidateName]:
    """Build pre-classified candidates from RSS person tags (PRD-04 B1/B2/B3),
    the recurring-host observation (PRD-04 A1), and the per-feed speaker
    cache of user confirmations (PRD-04 C1/C2).

    These candidates bypass NER and the heuristic rules in classify_candidates:
    their role and confidence are taken directly from the RSS tag they came
    from. Duplicates (same normalized name) are deduped with the stronger
    source winning — earlier entries in the iteration order win.

    Ordering (strongest first):
      - feed_speaker_cache, SPEAKER_00 entries → host, HIGH (recurring host)
      - feed_speaker_cache, SPEAKER_NN entries → guest, HIGH — but only
        when the name is corroborated by this episode's title /
        description / podcast:person tags (#703 PR 3). Recurring guests
        used to flood every episode with phantom candidates because
        the cache returned them unconditionally.
      - <podcast:person> at item level       → role as declared, HIGH
      - <podcast:person> at channel level    → role as declared, HIGH
      - itunes:author                        → host, HIGH
      - recurring_host_name                  → host, MEDIUM
      - itunes:owner                         → host, MEDIUM
      - dc:creator / <author> at item level  → host, MEDIUM

    feed_speaker_cache is placed at the top because its entries are direct
    user corrections — ground truth that overrides publisher-declared tags
    and inferred observations. <podcast:person> is placed ahead of
    itunes:author because the publisher explicitly tagged the person's role
    (host vs guest); the itunes tags only distinguish "on-air author" from
    "business contact" and always map to host, so they cannot contribute
    guests. Recurring-host is placed after publisher-declared tags because
    those are authoritative; recurring is observed ground truth that fills
    in when the publisher left the slot empty.

    Confidence note: recurring_host is emitted at MEDIUM — not HIGH — so its
    output rows in speaker_names do NOT satisfy the HIGH filter inside
    get_recurring_host_name. This blocks the self-reinforcement cascade that
    would otherwise let the rule bootstrap itself: every cycle must still
    consume a legitimate HIGH row (podcast:person, itunes:author, feed_title
    match) or a user-confirmed row before it can fire. feed_speaker_cache
    entries are safe at HIGH because the cache is only written on explicit
    user renames (confirmed_by_user=true) — inference output never populates
    it, so no self-reinforcement path exists.
    """
    out: list[CandidateName] = []
    seen: set[str] = set()

    def _add(candidate: Optional[CandidateName]) -> None:
        if candidate is None:
            return
        norm = normalize_name(candidate.name)
        if norm in seen:
            return
        seen.add(norm)
        out.append(candidate)

    # Pre-compute the corroboration haystack once for the SPEAKER_NN
    # gate (#703 PR 3). Empty when no episode text is available, in
    # which case every SPEAKER_NN cache entry is skipped.
    haystack = _build_corroboration_haystack(
        episode_title=episode_title,
        episode_description=episode_description,
        episode_podcast_persons=episode_podcast_persons,
    )

    for entry in feed_speaker_cache_priors or []:
        if not isinstance(entry, dict):
            continue
        name = (entry.get("name") or "").strip()
        if not name or not _looks_like_person_name(name):
            continue
        slot = (entry.get("speaker_label") or "").strip()
        if slot == _HOST_SLOT_LABEL:
            # Recurring host — emit unconditionally as host, HIGH.
            _add(
                CandidateName(
                    name=name,
                    source="feed_speaker_cache",
                    role="host",
                    confidence="HIGH",
                )
            )
        else:
            # Recurring guest / producer / one-off. Only seed when the
            # name is corroborated by this episode's text or
            # podcast:person tags (#703 PR 3); otherwise we'd pollute
            # every episode with the feed's full guest roster.
            if not _is_corroborated_in_episode(name, haystack):
                continue
            _add(
                CandidateName(
                    name=name,
                    source="feed_speaker_cache",
                    role="guest",
                    confidence="HIGH",
                )
            )

    for entry in episode_podcast_persons or []:
        _add(_podcast_person_to_candidate(entry, "podcast_person_episode"))
    for entry in feed_podcast_persons or []:
        _add(_podcast_person_to_candidate(entry, "podcast_person_feed"))

    if itunes_author and itunes_author.strip() and _looks_like_person_name(itunes_author):
        _add(
            CandidateName(
                name=itunes_author.strip(), source="itunes_author", role="host", confidence="HIGH"
            )
        )

    if (
        recurring_host_name
        and recurring_host_name.strip()
        and _looks_like_person_name(recurring_host_name)
    ):
        _add(
            CandidateName(
                name=recurring_host_name.strip(),
                source="recurring_host",
                role="host",
                confidence="MEDIUM",
            )
        )

    remaining = [
        (itunes_owner_name, "itunes_owner", "host", "MEDIUM"),
        (episode_author, "episode_author", "host", "MEDIUM"),
    ]
    for name, source, role, confidence in remaining:
        if not name or not name.strip():
            continue
        if not _looks_like_person_name(name):
            continue
        _add(CandidateName(name=name.strip(), source=source, role=role, confidence=confidence))
    return out
