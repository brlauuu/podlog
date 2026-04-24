"""
Host & guest inference from episode metadata — PRD-04

Uses spaCy NER to extract person names from episode/feed text, then classifies
them as host or guest using heuristic pattern matching. Assigns speaker slots
so SPEAKER_00 = first speaker to appear (host).

Memory note: spaCy model must be explicitly unloaded after use, following the
same GC pattern as Whisper and pyannote (PRD-01 §5.4).

Module layout (split under #554):
  - inference_types   — CandidateName, InferenceResult, METADATA_SOURCES
  - inference_ner     — spaCy NER + metadata candidate construction
  - inference_classify — merge + role/confidence classification
  - inference_db      — recurring-host query, feed-speaker cache, DB writes
  - inference_helpers — pure text helpers (strip_html, normalize_name, etc.)

This module is intentionally kept as the public surface: everything the
task layer (`app.tasks.infer`) or the test suite reaches for is still
importable via `from app.services.inference import ...`.
"""
import gc
import logging
import sys

# Re-export the pure text helper the test suite pulls through this module.
from app.services.inference_helpers import strip_html  # noqa: F401
from app.services.inference_classify import (
    classify_candidates,
    merge_candidates,
)
from app.services.inference_db import (
    get_feed_speaker_cache_priors,
    get_recurring_host_name,
    write_speaker_names,
)
from app.services.inference_ner import (
    extract_candidates,
    extract_metadata_candidates,
)
from app.services.inference_types import (
    METADATA_SOURCES,
    CandidateName,
    InferenceResult,
)

__all__ = [
    "CandidateName",
    "InferenceResult",
    "METADATA_SOURCES",
    "assign_speaker_slots",
    "classify_candidates",
    "extract_candidates",
    "extract_metadata_candidates",
    "get_feed_speaker_cache_priors",
    "get_recurring_host_name",
    "load_spacy_model",
    "merge_candidates",
    "strip_html",
    "unload_spacy_model",
    "write_speaker_names",
]

logger = logging.getLogger(__name__)


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
