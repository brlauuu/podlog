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
from dataclasses import dataclass, field

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

# Defaults for the run-based short-speaker detection in
# assign_speaker_slots (#703). See docs/guide/06-speakers.md when it
# lands (PR 5 of the issue) for the rationale.
DEFAULT_SHORT_RUN_SECONDS = 15.0
DEFAULT_SHORT_RUN_SEGMENTS = 20
DEFAULT_RUN_GAP_SECONDS = 2.0

__all__ = [
    "CandidateName",
    "InferenceResult",
    "METADATA_SOURCES",
    "SlotAssignment",
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


@dataclass(frozen=True)
class SlotAssignment:
    """Output of :func:`assign_speaker_slots` (#703).

    Carries per-segment new-label assignments (parallel to the input
    segments list) plus the subset of new labels that should be written
    as ``role='other'`` because the underlying pyannote label was
    fragmented into short runs.

    ``label_remap`` is the per-label mapping for "real" pyannote labels
    (those with at least one long enough run) — useful for diagnostics
    and callers that don't need the per-segment detail.
    """

    new_labels: list[str | None]
    other_labels: set[str] = field(default_factory=set)
    label_remap: dict[str, str] = field(default_factory=dict)

    def is_identity(self) -> bool:
        """True when no segment needs its label changed."""
        return not self.other_labels and all(
            v == k for k, v in self.label_remap.items()
        )


def assign_speaker_slots(
    result: InferenceResult | None,
    segments: list[dict],
    *,
    short_run_seconds: float = DEFAULT_SHORT_RUN_SECONDS,
    short_run_segments: int = DEFAULT_SHORT_RUN_SEGMENTS,
    run_gap_seconds: float = DEFAULT_RUN_GAP_SECONDS,
) -> SlotAssignment:
    """Remap pyannote speaker labels into final SPEAKER_NN slots (#703).

    Two-tier output, controlled by run analysis:

    1. **Real pyannote labels** — those whose segments contain at least
       one *real run* (run_duration_seconds ≥ ``short_run_seconds`` OR
       run_segment_count ≥ ``short_run_segments``). Every segment with
       such a label is given the same new SPEAKER_NN slot, assigned by
       order of first appearance: first real label → ``SPEAKER_00``
       (the host slot), next → ``SPEAKER_01``, etc.
    2. **Fully-short pyannote labels** — every run for the label is
       short. Each *run* (not each segment, and not each label) gets
       its own new SPEAKER_NN slot beyond the real-label range, in run
       first-appearance order, and each such slot is added to
       :attr:`SlotAssignment.other_labels` so the caller writes them
       as ``role='other'``.

    A run is a maximal sequence of consecutive same-label segments
    where adjacent pairs are at most ``run_gap_seconds`` apart and no
    other speaker spoke in between (the "no other speaker" condition
    is automatic because the input is time-sorted).

    ``result`` is currently accepted for backward-compat with prior
    call sites but is unused — the function only inspects the segment
    stream. It may be removed in a future revision.
    """
    if not segments:
        return SlotAssignment(new_labels=[])

    # --- Step 1: build runs from time-sorted segments ---
    # Each entry: dict with label, start_time, last_end, duration, seg_count,
    # and `members` (indices into the input list).
    runs: list[dict] = []
    current: dict | None = None
    for idx, seg in enumerate(segments):
        label = seg.get("speaker_label")
        if not label:
            if current is not None:
                runs.append(current)
                current = None
            continue
        if current is not None:
            gap = seg["start_time"] - current["last_end"]
            if current["label"] == label and gap <= run_gap_seconds:
                current["members"].append(idx)
                current["last_end"] = seg["end_time"]
                current["seg_count"] += 1
                current["duration"] += seg["end_time"] - seg["start_time"]
                continue
            runs.append(current)
        current = {
            "label": label,
            "start_time": seg["start_time"],
            "last_end": seg["end_time"],
            "members": [idx],
            "seg_count": 1,
            "duration": seg["end_time"] - seg["start_time"],
        }
    if current is not None:
        runs.append(current)

    if not runs:
        return SlotAssignment(new_labels=[None] * len(segments))

    # --- Step 2: classify each pyannote label as real or fully-short ---
    label_first_appearance: dict[str, float] = {}
    label_has_real_run: dict[str, bool] = {}
    for run in runs:
        lbl = run["label"]
        if lbl not in label_first_appearance:
            label_first_appearance[lbl] = run["start_time"]
        is_real = (
            run["duration"] >= short_run_seconds
            or run["seg_count"] >= short_run_segments
        )
        if is_real:
            label_has_real_run[lbl] = True
        else:
            label_has_real_run.setdefault(lbl, False)

    real_labels = {lbl for lbl, real in label_has_real_run.items() if real}

    # --- Step 3: number real labels (SPEAKER_00..) and short runs after them ---
    real_sorted = sorted(real_labels, key=lambda lbl: (label_first_appearance[lbl], lbl))
    label_remap: dict[str, str] = {
        old: f"SPEAKER_{i:02d}" for i, old in enumerate(real_sorted)
    }

    short_runs = [r for r in runs if r["label"] not in real_labels]
    short_runs.sort(key=lambda r: (r["start_time"], r["label"]))
    next_slot = len(real_sorted)
    other_labels: set[str] = set()
    # Map run -> new label by python id (each dict is a unique object).
    run_to_new: dict[int, str] = {}
    for run in short_runs:
        slot = f"SPEAKER_{next_slot:02d}"
        run_to_new[id(run)] = slot
        other_labels.add(slot)
        next_slot += 1

    # --- Step 4: build per-segment new label list ---
    new_labels: list[str | None] = [None] * len(segments)
    for run in runs:
        lbl = run["label"]
        if lbl in real_labels:
            target = label_remap[lbl]
        else:
            target = run_to_new[id(run)]
        for idx in run["members"]:
            new_labels[idx] = target

    return SlotAssignment(
        new_labels=new_labels,
        other_labels=other_labels,
        label_remap=label_remap,
    )
