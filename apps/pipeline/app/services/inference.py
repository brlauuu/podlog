"""
Host & guest inference from episode metadata — PRD-04

Uses spaCy NER to extract person names from episode/feed text, then classifies
them as host or guest using heuristic pattern matching. Assigns speaker slots
so SPEAKER_00 = first speaker to appear (host).

Memory note: spaCy model must be explicitly unloaded after use, following the
same GC pattern as Whisper and pyannote (PRD-01 §5.4).
"""
import gc
import logging
import re
import sys
from dataclasses import dataclass, field
from typing import Optional

from app.services.inference_helpers import (
    name_after_colon_in_title,
    name_near_guest_signal,
    name_near_host_pattern,
    normalize_name,
    strip_episode_prefix,
    strip_html,
)

# Source tags for candidates that come from RSS metadata (PRD-04 B1/B2/B3)
# rather than NER. classify_candidates honors their pre-assigned role and
# confidence instead of re-running heuristic rules on them.
METADATA_SOURCES = frozenset(
    {
        "itunes_author",
        "itunes_owner",
        "episode_author",
        "podcast_person_feed",
        "podcast_person_episode",
        "recurring_host",
        "feed_speaker_cache",
    }
)

# PRD-04 C1/C2: minimum number of user-confirmed renames of the same name
# on the same feed before the cache entry is surfaced as an inference prior.
# One rename could be a typo or a guest episode mislabel; requiring ≥2 means
# the name has persisted across at least two distinct user confirmations.
_FEED_SPEAKER_CACHE_MIN_COUNT = 2

# PRD-04 §4.2 A1: minimum absolute count required for the recurring-host
# rule to fire, independent of the threshold ratio. Without this, a feed
# with only 2 done episodes would trigger the rule from a single repeated
# name, which is too little evidence.
_RECURRING_HOST_MIN_COUNT = 3

# <podcast:person> role values that map to host/guest. Everything else is
# dropped rather than guessed — the Podcasting 2.0 role vocabulary is large
# (narrator, camera, editor, etc.) and most of it is production crew, not
# speakers in the audio. Roles here are drawn from the Podcast Namespace
# group="cast" taxonomy.
_PODCAST_HOST_ROLES = frozenset(
    {"host", "cohost", "co-host", "guest host", "presenter", "interviewer"}
)
_PODCAST_GUEST_ROLES = frozenset({"guest", "interviewee", "subject"})

logger = logging.getLogger(__name__)


@dataclass
class CandidateName:
    name: str
    # NER sources: episode_description, episode_title, feed_title, feed_description.
    # Metadata (RSS) sources: see METADATA_SOURCES — those bypass NER and carry
    # pre-assigned role/confidence.
    source: str
    role: str = "guest"  # "host" | "guest"
    confidence: str = "LOW"  # "HIGH" | "MEDIUM" | "LOW"


@dataclass
class InferenceResult:
    host: Optional[CandidateName] = None
    guests: list[CandidateName] = field(default_factory=list)
    raw_candidates: list[CandidateName] = field(default_factory=list)


def load_spacy_model():
    """Load spaCy model with trf→lg fallback. Returns the nlp pipeline."""
    import spacy

    from app.config import settings

    model_name = settings.spacy_model
    try:
        nlp = spacy.load(model_name)
        logger.info('"action": "spacy_loaded", "model": "%s"', model_name)
        return nlp
    except OSError:
        if model_name != "en_core_web_lg":
            logger.warning(
                "spaCy model %s not available, falling back to en_core_web_lg", model_name
            )
            try:
                nlp = spacy.load("en_core_web_lg")
                logger.info('"action": "spacy_loaded", "model": "en_core_web_lg"')
                return nlp
            except OSError:
                pass
        raise RuntimeError(
            f"No spaCy model available. Install {model_name} or en_core_web_lg."
        )


def unload_spacy_model() -> None:
    """Remove spaCy model from memory. Same GC pattern as Whisper/pyannote."""
    mod = sys.modules.get("app.services.inference")
    if mod and hasattr(mod, "_nlp"):
        mod._nlp = None

    gc.collect()
    logger.info('"action": "spacy_unloaded"')


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


_ORG_SUFFIX_RE = re.compile(
    r"\b(?:LLC|L\.L\.C\.|Inc\.?|Corp\.?|Co\.?|Ltd\.?|GmbH|SA|AG|Media|Network|"
    r"Networks|Productions|Studios?|Podcasts?|Radio|Group|Company|Communications)\b",
    re.IGNORECASE,
)


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


def get_recurring_host_name(
    db,
    feed_id: str,
    current_episode_id: Optional[str] = None,
    window: int = 10,
    threshold: float = 0.8,
) -> Optional[str]:
    """Return the display name that recurs as host across a feed's recent episodes.

    PRD-04 §4.2 A1 — looks at the feed's last `window` episodes with status=done
    (excluding current_episode_id if given), counts SPEAKER_00 display names
    from speaker_names rows that are either user-confirmed or HIGH-confidence
    inferred. If one name dominates (count ≥ `threshold * window` AND count
    ≥ _RECURRING_HOST_MIN_COUNT) it is returned so the caller can seed it as
    the host candidate for the current episode. The caller writes recurring
    inferences at MEDIUM confidence so they cannot self-reinforce (see the
    HIGH filter below).

    LOW/MEDIUM inferred rows are excluded to prevent self-reinforcement:
      - MEDIUM guards against recurring_host inferences seeding themselves —
        every row this rule writes is MEDIUM, so only user-confirmed rows or
        HIGH rows from another source (podcast:person, itunes:author,
        feed_title match) feed the next cycle.
      - LOW guards against single-NER-guess propagation.

    Ordering: episodes are pulled newest-first by `published_at DESC` with
    `id DESC` as a tiebreaker for feeds with NULL or duplicate timestamps,
    so the window is deterministic. On tied counts the most-recent display
    form wins (see the loop below).
    """
    from sqlalchemy import or_

    from app.models import Episode, SpeakerName

    if not feed_id:
        return None

    episode_query = (
        db.query(Episode.id)
        .filter(Episode.feed_id == feed_id)
        .filter(Episode.status == "done")
    )
    if current_episode_id:
        episode_query = episode_query.filter(Episode.id != current_episode_id)
    episode_ids = [
        row[0]
        for row in episode_query.order_by(
            Episode.published_at.desc().nullslast(), Episode.id.desc()
        )
        .limit(window)
        .all()
    ]
    if not episode_ids:
        return None

    rows = (
        db.query(SpeakerName.display_name, SpeakerName.episode_id)
        .filter(SpeakerName.episode_id.in_(episode_ids))
        .filter(SpeakerName.speaker_label == "SPEAKER_00")
        .filter(
            or_(
                SpeakerName.confirmed_by_user.is_(True),
                (SpeakerName.inferred.is_(True)) & (SpeakerName.confidence == "HIGH"),
            )
        )
        .all()
    )
    if not rows:
        return None

    # in_() does not preserve list order, so sort rows by episode recency
    # (episode_ids is already newest-first). Iterating newest-first means
    # the first display form seen for each name is the most-recent casing.
    ep_index = {eid: i for i, eid in enumerate(episode_ids)}
    rows_sorted = sorted(rows, key=lambda r: ep_index.get(r[1], len(ep_index)))

    counts: dict[str, tuple[str, int, int]] = {}  # norm → (display, count, newest_rank)
    for name, ep_id in rows_sorted:
        if not name or not name.strip():
            continue
        norm = normalize_name(name)
        if not norm:
            continue
        rank = ep_index.get(ep_id, len(ep_index))
        if norm in counts:
            display, prev, newest_rank = counts[norm]
            # Preserve the original (newest-first-seen) rank so the tiebreak
            # compares the most recent occurrence, not the oldest.
            counts[norm] = (display, prev + 1, newest_rank)
        else:
            # First (newest) occurrence — capture its display form and rank.
            counts[norm] = (name.strip(), 1, rank)

    if not counts:
        return None

    # Tiebreak on ties: lower `newest_rank` (= more recent) wins, so a mid-feed
    # host swap resolves to the current host rather than the predecessor.
    top_norm, (top_name, top_count, _) = max(
        counts.items(), key=lambda kv: (kv[1][1], -kv[1][2])
    )
    required = max(_RECURRING_HOST_MIN_COUNT, int(threshold * window))
    if top_count < required:
        return None
    return top_name


def get_feed_speaker_cache_priors(
    db,
    feed_id: Optional[str],
    min_count: int = _FEED_SPEAKER_CACHE_MIN_COUNT,
    recency_days: Optional[int] = None,
) -> list[dict]:
    """Return user-confirmed speaker names cached on this feed (PRD-04 C1/C2).

    The cache is populated only from `confirmed_by_user=true` events in the
    web rename API. Inference output never writes here, so the cache cannot
    self-reinforce.

    Returns a list of {name, speaker_label, occurrence_count} dicts sorted
    strongest-first (count DESC, last_seen DESC). Only names confirmed at
    least `min_count` times are surfaced — one-off confirmations are too
    often guest episodes or typos to be a reliable prior.

    If `recency_days` is a positive integer, entries whose `last_seen_at`
    is older than that cutoff are ignored; a long-ago confirmation can't
    outrank a recent one. Defaults to settings.feed_speaker_cache_recency_days
    when None; pass 0 to disable the cutoff.

    The consumer (extract_metadata_candidates) emits these as HIGH candidates
    with role="host": recurrence across user confirmations means the same
    person keeps showing up, which is the defining property of a host, not
    a guest. If the heuristic classifier later disagrees (e.g. the name
    appears in a guest-proximity pattern), the later dedup will keep the
    cache entry because METADATA_SOURCES bypasses heuristic reclassification.
    """
    from datetime import datetime, timedelta, timezone

    from app.config import settings
    from app.models import FeedSpeakerCache

    if not feed_id:
        return []

    if recency_days is None:
        recency_days = settings.feed_speaker_cache_recency_days

    query = (
        db.query(
            FeedSpeakerCache.display_name,
            FeedSpeakerCache.speaker_label,
            FeedSpeakerCache.occurrence_count,
        )
        .filter(FeedSpeakerCache.feed_id == feed_id)
        .filter(FeedSpeakerCache.occurrence_count >= min_count)
    )
    if recency_days and recency_days > 0:
        cutoff = datetime.now(timezone.utc) - timedelta(days=recency_days)
        query = query.filter(FeedSpeakerCache.last_seen_at >= cutoff)
    rows = query.order_by(
        FeedSpeakerCache.occurrence_count.desc(),
        FeedSpeakerCache.last_seen_at.desc(),
    ).all()
    return [
        {"name": r[0], "speaker_label": r[1], "occurrence_count": r[2]}
        for r in rows
    ]


def extract_metadata_candidates(
    itunes_author: Optional[str],
    itunes_owner_name: Optional[str],
    episode_author: Optional[str],
    feed_podcast_persons: Optional[list[dict]] = None,
    episode_podcast_persons: Optional[list[dict]] = None,
    recurring_host_name: Optional[str] = None,
    feed_speaker_cache_priors: Optional[list[dict]] = None,
) -> list[CandidateName]:
    """Build pre-classified candidates from RSS person tags (PRD-04 B1/B2/B3),
    the recurring-host observation (PRD-04 A1), and the per-feed speaker
    cache of user confirmations (PRD-04 C1/C2).

    These candidates bypass NER and the heuristic rules in classify_candidates:
    their role and confidence are taken directly from the RSS tag they came
    from. Duplicates (same normalized name) are deduped with the stronger
    source winning — earlier entries in the iteration order win.

    Ordering (strongest first):
      - feed_speaker_cache (user-confirmed)  → host, HIGH
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

    for entry in feed_speaker_cache_priors or []:
        name = (entry.get("name") or "").strip() if isinstance(entry, dict) else ""
        if not name or not _looks_like_person_name(name):
            continue
        _add(
            CandidateName(
                name=name,
                source="feed_speaker_cache",
                role="host",
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


def merge_candidates(
    metadata_candidates: list[CandidateName],
    ner_candidates: list[CandidateName],
) -> list[CandidateName]:
    """Combine metadata and NER candidates, deduping by normalized name.

    A name present in both lists keeps the metadata entry (already carries
    stronger role/confidence). The metadata list is returned first so the
    classifier handles those before heuristics.
    """
    seen = {normalize_name(c.name) for c in metadata_candidates}
    out = list(metadata_candidates)
    for c in ner_candidates:
        norm = normalize_name(c.name)
        if norm in seen:
            continue
        seen.add(norm)
        out.append(c)
    return out


def classify_candidates(
    candidates: list[CandidateName],
    episode_description: Optional[str],
    feed_title: Optional[str],
    feed_description: Optional[str],
    episode_title: Optional[str] = None,
) -> InferenceResult:
    """Classify candidates as host or guest using heuristic rules (PRD-04 §4.2).

    Candidates whose source is in METADATA_SOURCES (PRD-04 B1 + B3) are
    honored with their pre-assigned role/confidence and skip heuristic
    rules. All other candidates go through the NER-derived rule chain.

    episode_title (PRD-04 E1) is used in addition to episode_description's
    first line for the "name after colon" guest rule.
    """
    if not candidates:
        return InferenceResult()

    # Clean texts for matching
    ep_desc = strip_html(episode_description).lower() if episode_description else ""
    f_title = feed_title.lower() if feed_title else ""
    f_desc = strip_html(feed_description).lower() if feed_description else ""
    ep_title = episode_title or ""

    host: Optional[CandidateName] = None
    guests: list[CandidateName] = []

    for c in candidates:
        # Metadata candidates carry pre-assigned role/confidence from the
        # RSS tag they came from (PRD-04 B1/B2/B3).
        if c.source in METADATA_SOURCES:
            if c.role == "host":
                if host is None:
                    host = c
                else:
                    # Second metadata host candidate → secondary slot as
                    # guest. For <podcast:person>, recurring_host, and
                    # feed_speaker_cache the signal is strong enough to
                    # preserve the candidate's own confidence
                    # (podcast:person is publisher-declared HIGH;
                    # recurring_host is observed across many episodes at
                    # MEDIUM; feed_speaker_cache is user-confirmed HIGH —
                    # all cover cohost shows, L-02). For itunes:author/owner
                    # we demote to LOW because the second slot is usually
                    # the owner (a business contact, not an on-air voice).
                    # Don't mutate the caller's CandidateName in place —
                    # return a fresh object so repeated classification calls
                    # are idempotent.
                    demoted_conf = (
                        c.confidence
                        if c.source.startswith("podcast_person")
                        or c.source == "recurring_host"
                        or c.source == "feed_speaker_cache"
                        else "LOW"
                    )
                    guests.append(
                        CandidateName(
                            name=c.name,
                            source=c.source,
                            role="guest",
                            confidence=demoted_conf,
                        )
                    )
            else:
                guests.append(c)
            continue

        name_lower = c.name.lower()

        # Host signals — check feed title first (HIGH confidence)
        if f_title and name_lower in f_title:
            c.role = "host"
            c.confidence = "HIGH"
            if not host:
                host = c
            else:
                # Already have a host, treat as guest
                c.role = "guest"
                c.confidence = "LOW"
                guests.append(c)
            continue

        # Host signals — check feed description patterns (MEDIUM confidence)
        if f_desc and name_near_host_pattern(name_lower, f_desc):
            c.role = "host"
            c.confidence = "MEDIUM"
            if not host:
                host = c
            else:
                c.role = "guest"
                c.confidence = "LOW"
                guests.append(c)
            continue

        # Guest signals — check episode description proximity (HIGH/MEDIUM confidence)
        if ep_desc:
            guest_confidence = name_near_guest_signal(name_lower, ep_desc)
            if guest_confidence:
                c.role = "guest"
                c.confidence = guest_confidence
                guests.append(c)
                continue

        # Guest signals — name after colon in episode title or description's
        # first line. PRD-04 E1: episode.title is the more reliable source.
        if (
            name_after_colon_in_title(c.name, ep_title)
            or name_after_colon_in_title(c.name, episode_description or "")
        ):
            c.role = "guest"
            c.confidence = "HIGH"
            guests.append(c)
            continue

        # Fallback: guest with LOW confidence
        c.role = "guest"
        c.confidence = "LOW"
        guests.append(c)

    # PRD-04 §4.2: if only one name found total, classify as guest LOW.
    # Skip this reclassification when the single name came from RSS metadata
    # (itunes:author etc.) — those tags are ground truth for host identity
    # and should not be demoted just because the episode has no guest listed.
    if (
        len(candidates) == 1
        and host
        and not guests
        and host.source not in METADATA_SOURCES
    ):
        host.role = "guest"
        host.confidence = "LOW"
        guests.append(host)
        host = None

    return InferenceResult(host=host, guests=guests, raw_candidates=candidates)


def assign_speaker_slots(
    result: InferenceResult,
    segments: list[dict],
) -> dict[str, str]:
    """
    Remap pyannote speaker labels so SPEAKER_00 = first speaker (host).
    Returns a mapping of {old_label: new_label}.

    Speakers are numbered by order of first appearance: the first person
    to speak is SPEAKER_00 (host), others get SPEAKER_01, SPEAKER_02, etc.
    """
    if not segments:
        return {}

    # Track first appearance of each speaker
    first_appearance: dict[str, float] = {}
    for seg in segments:
        label = seg.get("speaker_label")
        if not label:
            continue
        if label not in first_appearance:
            first_appearance[label] = seg["start_time"]

    if not first_appearance:
        return {}

    # Sort by first appearance — first speaker becomes SPEAKER_00 (host)
    sorted_speakers = sorted(first_appearance.keys(), key=lambda s: (first_appearance[s], s))

    label_map: dict[str, str] = {}
    for i, old_label in enumerate(sorted_speakers):
        label_map[old_label] = f"SPEAKER_{i:02d}"

    return label_map


def write_speaker_names(
    episode_id: str,
    label_map: dict[str, str],
    result: InferenceResult,
    db,
) -> None:
    """Write inferred display names to the speaker_names table."""
    from app.models import SpeakerName

    # Build a map of new_label → candidate name
    name_assignments: dict[str, CandidateName] = {}

    if result.host:
        name_assignments["SPEAKER_00"] = result.host

    # Assign guests to SPEAKER_01, SPEAKER_02, etc. in order
    for i, guest in enumerate(result.guests):
        slot = f"SPEAKER_{i + 1:02d}"
        name_assignments[slot] = guest

    for new_label, candidate in name_assignments.items():
        existing = (
            db.query(SpeakerName)
            .filter(
                SpeakerName.episode_id == episode_id,
                SpeakerName.speaker_label == new_label,
            )
            .first()
        )
        if existing and existing.confirmed_by_user:
            # Don't overwrite user-confirmed names
            continue

        if existing:
            existing.display_name = candidate.name
            existing.inferred = True
            existing.confidence = candidate.confidence
            existing.confirmed_by_user = False
        else:
            db.add(
                SpeakerName(
                    episode_id=episode_id,
                    speaker_label=new_label,
                    display_name=candidate.name,
                    inferred=True,
                    confidence=candidate.confidence,
                    confirmed_by_user=False,
                )
            )
