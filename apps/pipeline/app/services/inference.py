"""
Host & guest inference from episode metadata — PRD-04

Uses spaCy NER to extract person names from episode/feed text, then classifies
them as host or guest using heuristic pattern matching. Assigns speaker slots
so SPEAKER_00 = host (most speaking time).

Memory note: spaCy model must be explicitly unloaded after use, following the
same GC pattern as Whisper and pyannote (PRD-01 §5.4).
"""
import gc
import logging
import re
import sys
from dataclasses import dataclass, field
from html.parser import HTMLParser
from io import StringIO
from typing import Optional

logger = logging.getLogger(__name__)

# Proximity window (in characters) for guest signal detection
GUEST_PROXIMITY_CHARS = 200

GUEST_SIGNAL_PATTERNS = [
    r"\bguest\b",
    r"\bjoin(?:s|ing|ed)?\b",
    r"\btoday'?s guest\b",
    r"\bfeaturing\b",
    r"\bfeat\.?\b",
    r"\binterview(?:s|ing|ed)?\b",
    r"\bsit(?:s|ting)? down with\b",
    r"\btalk(?:s|ing)? to\b",
    r"\bwelcome(?:s|d)?\b",
    r"\bwith me today\b",
    r"\bmy guest\b",
    r"\bspecial guest\b",
]

HOST_DESCRIPTION_PATTERNS = [
    r"\bhosted by\b",
    r"\bhost of\b",
    r"\byour host\b",
    r"\bI'?m\b",
]


@dataclass
class CandidateName:
    name: str
    source: str  # "episode_description" | "feed_title" | "feed_description"
    role: str = "guest"  # "host" | "guest"
    confidence: str = "LOW"  # "HIGH" | "MEDIUM" | "LOW"


@dataclass
class InferenceResult:
    host: Optional[CandidateName] = None
    guests: list[CandidateName] = field(default_factory=list)
    raw_candidates: list[CandidateName] = field(default_factory=list)


class _HTMLStripper(HTMLParser):
    """Minimal HTML tag stripper."""

    def __init__(self):
        super().__init__()
        self._text = StringIO()

    def handle_data(self, data):
        self._text.write(data)

    def get_text(self) -> str:
        return self._text.getvalue()


def strip_html(text: str) -> str:
    """Strip HTML tags from text (PRD-04 L-05)."""
    stripper = _HTMLStripper()
    stripper.feed(text)
    return stripper.get_text()


def _normalize_name(name: str) -> str:
    """Lowercase, collapse whitespace."""
    return " ".join(name.lower().split())


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
) -> list[CandidateName]:
    """Extract PERSON entities from all available text sources."""
    candidates: list[CandidateName] = []
    seen_normalized: set[str] = set()

    sources = [
        (episode_description, "episode_description"),
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
            norm = _normalize_name(ent.text)
            if norm in seen_normalized:
                continue
            seen_normalized.add(norm)
            candidates.append(CandidateName(name=ent.text.strip(), source=source_name))

    return candidates


def classify_candidates(
    candidates: list[CandidateName],
    episode_description: Optional[str],
    feed_title: Optional[str],
    feed_description: Optional[str],
) -> InferenceResult:
    """Classify candidates as host or guest using heuristic rules (PRD-04 §4.2)."""
    if not candidates:
        return InferenceResult()

    # Clean texts for matching
    ep_desc = strip_html(episode_description).lower() if episode_description else ""
    f_title = feed_title.lower() if feed_title else ""
    f_desc = strip_html(feed_description).lower() if feed_description else ""

    host: Optional[CandidateName] = None
    guests: list[CandidateName] = []

    for c in candidates:
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
        if f_desc and _name_near_host_pattern(name_lower, f_desc):
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
            guest_confidence = _name_near_guest_signal(name_lower, ep_desc)
            if guest_confidence:
                c.role = "guest"
                c.confidence = guest_confidence
                guests.append(c)
                continue

        # Guest signals — name after colon in episode title pattern
        if ep_desc and _name_after_colon_in_title(c.name, episode_description or ""):
            c.role = "guest"
            c.confidence = "HIGH"
            guests.append(c)
            continue

        # Fallback: guest with LOW confidence
        c.role = "guest"
        c.confidence = "LOW"
        guests.append(c)

    # PRD-04 §4.2: if only one name found total, classify as guest LOW
    if len(candidates) == 1 and host and not guests:
        host.role = "guest"
        host.confidence = "LOW"
        guests.append(host)
        host = None

    return InferenceResult(host=host, guests=guests, raw_candidates=candidates)


def _name_near_host_pattern(name_lower: str, feed_desc_lower: str) -> bool:
    """Check if name appears near host-signal phrases in feed description."""
    for pattern in HOST_DESCRIPTION_PATTERNS:
        for m in re.finditer(pattern, feed_desc_lower):
            # Look for name within proximity of the pattern match
            start = max(0, m.start() - GUEST_PROXIMITY_CHARS)
            end = min(len(feed_desc_lower), m.end() + GUEST_PROXIMITY_CHARS)
            window = feed_desc_lower[start:end]
            if name_lower in window:
                return True
    return False


def _name_near_guest_signal(name_lower: str, ep_desc_lower: str) -> Optional[str]:
    """Check if name appears near guest-signal phrases. Returns confidence or None."""
    strong_patterns = [r"\bmy guest\b", r"\btoday'?s guest\b", r"\bspecial guest\b"]
    for pattern in GUEST_SIGNAL_PATTERNS:
        for m in re.finditer(pattern, ep_desc_lower):
            start = max(0, m.start() - GUEST_PROXIMITY_CHARS)
            end = min(len(ep_desc_lower), m.end() + GUEST_PROXIMITY_CHARS)
            window = ep_desc_lower[start:end]
            if name_lower in window:
                is_strong = any(re.search(sp, window) for sp in strong_patterns)
                return "HIGH" if is_strong else "MEDIUM"
    return None


def _name_after_colon_in_title(name: str, episode_description: str) -> bool:
    """Check for 'Ep N: Name ...' pattern in the first line of description."""
    first_line = episode_description.split("\n")[0]
    if ":" not in first_line:
        return False
    after_colon = first_line.split(":", 1)[1].strip()
    return name.lower() in after_colon.lower()


def assign_speaker_slots(
    result: InferenceResult,
    segments: list[dict],
) -> dict[str, str]:
    """
    Remap pyannote speaker labels so SPEAKER_00 = most speaking time (host).
    Returns a mapping of {old_label: new_label}.

    Per PRD-04 §4.5: remapping always applies (even without host inference)
    to ensure SPEAKER_00 is consistently the highest-speaking-time speaker.
    """
    if not segments:
        return {}

    # Calculate total speaking time per speaker
    speaking_time: dict[str, float] = {}
    first_appearance: dict[str, float] = {}
    for seg in segments:
        label = seg.get("speaker_label")
        if not label:
            continue
        duration = seg["end_time"] - seg["start_time"]
        speaking_time[label] = speaking_time.get(label, 0.0) + duration
        if label not in first_appearance:
            first_appearance[label] = seg["start_time"]

    if not speaking_time:
        return {}

    # Sort by speaking time descending — most talkative speaker becomes SPEAKER_00
    sorted_speakers = sorted(speaking_time.keys(), key=lambda s: speaking_time[s], reverse=True)

    # Guest speakers (non-host) sorted by first appearance
    host_old_label = sorted_speakers[0]
    guest_old_labels = sorted(sorted_speakers[1:], key=lambda s: first_appearance[s])

    label_map: dict[str, str] = {host_old_label: "SPEAKER_00"}
    for i, old_label in enumerate(guest_old_labels):
        label_map[old_label] = f"SPEAKER_{i + 1:02d}"

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
