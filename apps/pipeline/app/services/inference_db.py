"""Database-facing operations for the inference pipeline (PRD-04).

Two reads that inform candidate construction (recurring-host observation
and the per-feed user-confirmation cache) and one write that persists
the final inferred host/guest names.

Extracted from inference.py to isolate DB I/O from the classification
logic. Nothing here decides roles or confidences — that belongs in
inference_classify.

End-user-facing description of the recurring-host rule, the per-feed
cache, and the SPEAKER_00 vs SPEAKER_NN gating lives in
docs/guide/06-speakers.md under "Where candidates come from". Update
both files together when changing these queries.
"""
import logging
from typing import Optional

from app.services.inference_helpers import normalize_name
from app.services.inference_types import CandidateName, InferenceResult

logger = logging.getLogger(__name__)

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


def write_speaker_names(
    episode_id: str,
    label_map: dict[str, str],
    result: InferenceResult,
    db,
) -> None:
    """Write inferred display names to the speaker_names table.

    Only writes a row when the candidate's SPEAKER_NN slot actually exists
    in this episode's segments (#703). The classifier produces a guest
    list that includes every recurring-guest name from the feed cache,
    which is typically much larger than the number of distinct speakers
    in any single episode; writing the surplus produced phantom rows
    that listed people who were not in the audio at all.
    """
    from app.models import Segment, SpeakerName

    # Build a map of new_label → candidate name
    name_assignments: dict[str, CandidateName] = {}

    if result.host:
        name_assignments["SPEAKER_00"] = result.host

    # Assign guests to SPEAKER_01, SPEAKER_02, etc. in order
    for i, guest in enumerate(result.guests):
        slot = f"SPEAKER_{i + 1:02d}"
        name_assignments[slot] = guest

    # The set of speaker_labels that actually appear in this episode's
    # segments. Computed once instead of per-candidate.
    existing_labels = {
        row[0]
        for row in db.query(Segment.speaker_label)
        .filter(Segment.episode_id == episode_id)
        .filter(Segment.speaker_label.isnot(None))
        .distinct()
        .all()
    }

    for new_label, candidate in name_assignments.items():
        if new_label not in existing_labels:
            # No segment carries this label — writing a row would create
            # a phantom speaker entry. Skip silently; the classifier had
            # more candidates than the episode has speakers.
            continue
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
