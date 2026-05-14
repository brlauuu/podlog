"""Role / confidence classification for the inference pipeline (PRD-04).

Takes the union of NER and metadata candidates (merge_candidates) and
assigns each a final host/guest role at HIGH / MEDIUM / LOW confidence
(classify_candidates).

Heuristic rules live here so the extraction modules (inference_ner,
inference_db) stay extraction-only.

End-user-facing description of the host/guest rules and their
confidences lives in docs/guide/06-speakers.md under "How names get
classified". Update both files together when changing the rule set.
"""
import logging
from typing import Optional

from app.services.inference_helpers import (
    name_after_colon_in_title,
    name_near_guest_signal,
    name_near_host_pattern,
    normalize_name,
    strip_html,
)
from app.services.inference_types import METADATA_SOURCES, CandidateName, InferenceResult

logger = logging.getLogger(__name__)


def merge_candidates(
    metadata_candidates: list[CandidateName],
    ner_candidates: list[CandidateName],
    feed_title: Optional[str] = None,
) -> list[CandidateName]:
    """Combine metadata and NER candidates, deduping by normalized name.

    A name present in both lists keeps the metadata entry (already carries
    stronger role/confidence). The metadata list is returned first so the
    classifier handles those before heuristics.

    Confidence reconciliation (issue #530): when a dropped NER duplicate would
    have classified at HIGH via feed_title match (the canonical HIGH host
    signal in classify_candidates), promote the retained metadata entry to
    HIGH so the dedup does not shadow the stronger corroborating signal.
    Without this, a MEDIUM recurring_host candidate for the same name writes
    a MEDIUM speaker_names row, which then fails the HIGH-only filter in
    get_recurring_host_name and causes the rule to oscillate as the window
    fills with self-generated MEDIUM rows. Only applied when roles align
    (metadata host + feed_title match always implies host) — cross-role
    NER-HIGH paths (name_after_colon_in_title → guest HIGH) do not reconcile.
    """
    f_title_lower = feed_title.lower() if feed_title else None
    metadata_by_norm: dict[str, CandidateName] = {}
    out: list[CandidateName] = []
    for c in metadata_candidates:
        norm = normalize_name(c.name)
        metadata_by_norm[norm] = c
        out.append(c)
    seen = set(metadata_by_norm.keys())
    for c in ner_candidates:
        norm = normalize_name(c.name)
        if norm in seen:
            meta = metadata_by_norm.get(norm)
            if (
                meta is not None
                and meta.role == "host"
                and meta.confidence != "HIGH"
                and f_title_lower
                and c.name.lower() in f_title_lower
            ):
                meta.confidence = "HIGH"
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
