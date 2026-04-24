"""Shared types and source-tag constants for the inference pipeline (PRD-04).

Kept separate from `inference.py` so the behavior modules
(`inference_db`, `inference_ner`, `inference_classify`) can import
`CandidateName` / `InferenceResult` without pulling in `inference.py`'s
re-exports of those same modules (circular import).
"""
from dataclasses import dataclass, field
from typing import Optional


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
