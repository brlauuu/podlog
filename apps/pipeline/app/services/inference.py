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
    }
)

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


def extract_metadata_candidates(
    itunes_author: Optional[str],
    itunes_owner_name: Optional[str],
    episode_author: Optional[str],
    feed_podcast_persons: Optional[list[dict]] = None,
    episode_podcast_persons: Optional[list[dict]] = None,
) -> list[CandidateName]:
    """Build pre-classified candidates from RSS person tags (PRD-04 B1/B2/B3).

    These candidates bypass NER and the heuristic rules in classify_candidates:
    their role and confidence are taken directly from the RSS tag they came
    from. Duplicates (same normalized name) are deduped with the stronger
    source winning — earlier entries in the iteration order win.

    Ordering (strongest first):
      - <podcast:person> at item level       → role as declared, HIGH
      - <podcast:person> at channel level    → role as declared, HIGH
      - itunes:author                        → host, HIGH
      - itunes:owner                         → host, MEDIUM
      - dc:creator / <author> at item level  → host, MEDIUM

    <podcast:person> is placed ahead of itunes:author because the publisher
    explicitly tagged the person's role (host vs guest); the itunes tags only
    distinguish "on-air author" from "business contact" and always map to
    host, so they cannot contribute guests.
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

    for entry in episode_podcast_persons or []:
        _add(_podcast_person_to_candidate(entry, "podcast_person_episode"))
    for entry in feed_podcast_persons or []:
        _add(_podcast_person_to_candidate(entry, "podcast_person_feed"))

    itunes_ordered = [
        (itunes_author, "itunes_author", "host", "HIGH"),
        (itunes_owner_name, "itunes_owner", "host", "MEDIUM"),
        (episode_author, "episode_author", "host", "MEDIUM"),
    ]
    for name, source, role, confidence in itunes_ordered:
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
                    # guest. For <podcast:person> the publisher explicitly
                    # declared this person, so keep HIGH confidence (covers
                    # cohost shows — L-02). For itunes:author/owner we demote
                    # to LOW because the second slot is usually the owner
                    # (a business contact, not an on-air voice). Don't mutate
                    # the caller's CandidateName in place — return a fresh
                    # object so repeated classification calls are idempotent.
                    demoted_conf = (
                        "HIGH" if c.source.startswith("podcast_person") else "LOW"
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
