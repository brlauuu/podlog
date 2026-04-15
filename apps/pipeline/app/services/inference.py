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
import sys
from dataclasses import dataclass, field
from typing import Optional

from app.services.inference_helpers import (
    name_after_colon_in_title,
    name_near_guest_signal,
    name_near_host_pattern,
    normalize_name,
    strip_html,
)

logger = logging.getLogger(__name__)


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
            norm = normalize_name(ent.text)
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

        # Guest signals — name after colon in episode title pattern
        if ep_desc and name_after_colon_in_title(c.name, episode_description or ""):
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
