"""Aggregation helpers for the meta-analysis snapshot (Issue #521).

Split out of `meta_analysis.py` (#662): the orchestrator there owns the
public entry points and the stale-flag lifecycle; this module owns the
per-feed / per-episode / per-speaker / timeline / coverage builders that
actually shape the snapshot's JSONB body.

Re-exported from `meta_analysis` for backward-compatibility — existing
tests refer to e.g. `svc._count_turns` through the orchestrator module.
"""
import logging
from typing import Any

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.orm import Session

from app.models import (
    Chunk,
    Episode,
    Feed,
    Segment,
    SpeakerName,
)
from app.services.inference_helpers import normalize_name

logger = logging.getLogger(__name__)


try:
    import tiktoken
    _ENC = tiktoken.get_encoding("cl100k_base")

    def _count_tokens(text: str) -> int:
        return len(_ENC.encode(text)) if text else 0

    _TOKENIZER_AVAILABLE = True
except Exception:  # pragma: no cover -- defensive import guard
    _TOKENIZER_AVAILABLE = False
    logger.warning("tiktoken unavailable; meta-analysis token counts will be zero")

    def _count_tokens(text: str) -> int:
        return 0


def _per_feed(db: Session) -> list[dict[str, Any]]:
    """Per-feed aggregates over done episodes only."""
    rows = db.execute(
        select(
            Feed.id.label("feed_id"),
            Feed.title,
            func.count(Episode.id).label("episode_count"),
            func.avg(Episode.duration_secs).label("avg_secs"),
            func.stddev_samp(Episode.duration_secs).label("std_secs"),
            func.coalesce(
                func.sum(Episode.fireworks_stt_cost_usd), 0.0
            ).label("total_cost_usd"),
            func.coalesce(
                func.sum(Episode.fireworks_audio_minutes), 0.0
            ).label("total_audio_minutes"),
        )
        .join(Episode, Episode.feed_id == Feed.id)
        .where(Episode.status == "done")
        .group_by(Feed.id, Feed.title)
    ).all()

    return [
        {
            "feed_id": r.feed_id,
            "title": r.title or "(untitled)",
            "episode_count": r.episode_count,
            "avg_length_min": round(float(r.avg_secs or 0) / 60.0, 2),
            "std_length_min": round(float(r.std_secs or 0) / 60.0, 2),
            "total_cost_usd": round(float(r.total_cost_usd or 0), 4),
            "total_audio_minutes": round(float(r.total_audio_minutes or 0), 2),
            # Remaining fields filled in by later tasks; stub now to keep
            # the JSON shape stable.
            "total_words": 0,
            "total_tokens_segments": 0,
            "total_tokens_chunks": 0,
            "inferred_host_name": None,
        }
        for r in rows
    ]


def _count_turns(segments: list) -> int:
    """Count speaker changes. Each change = one new turn."""
    if not segments:
        return 0
    sorted_segs = sorted(segments, key=lambda s: s.start_time)
    turns = 1
    prev = sorted_segs[0].speaker_label
    for s in sorted_segs[1:]:
        if s.speaker_label != prev:
            turns += 1
            prev = s.speaker_label
    return turns


def _per_episode(db: Session) -> list[dict[str, Any]]:
    """Per-episode aggregates. Pulls segment and chunk text for token counting."""
    ep_rows = db.execute(
        select(
            Episode.id,
            Episode.feed_id,
            Episode.published_at,
            Episode.duration_secs,
            Episode.fireworks_stt_cost_usd,
            Episode.transcribe_duration_secs,
            Episode.diarize_duration_secs,
            Episode.inference_provider_used,
        ).where(Episode.status == "done", Episode.feed_id.isnot(None))
    ).all()

    seg_rows = db.execute(
        select(Segment.episode_id, Segment.text, Segment.speaker_label,
               Segment.start_time, Segment.end_time)
    ).all()
    seg_by_ep: dict[str, list] = {}
    for s in seg_rows:
        seg_by_ep.setdefault(s.episode_id, []).append(s)

    chunk_rows = db.execute(select(Chunk.episode_id, Chunk.text)).all()
    chunk_text_by_ep: dict[str, list[str]] = {}
    for c in chunk_rows:
        chunk_text_by_ep.setdefault(c.episode_id, []).append(c.text)

    out = []
    for er in ep_rows:
        segs = seg_by_ep.get(er.id, [])
        words = sum(len(s.text.split()) for s in segs)
        seg_tokens = sum(_count_tokens(s.text) for s in segs)
        chunk_tokens = sum(_count_tokens(t) for t in chunk_text_by_ep.get(er.id, []))
        speakers = {s.speaker_label for s in segs if s.speaker_label}
        turn_count = _count_turns(segs)
        total_seconds = max((er.duration_secs or 0), 1)
        wpm = round(words / (total_seconds / 60.0), 1) if words else 0.0

        out.append({
            "episode_id": er.id,
            "feed_id": er.feed_id,
            "published_at": er.published_at.isoformat() if er.published_at else None,
            "duration_secs": er.duration_secs or 0,
            "word_count": words,
            "token_count_segments": seg_tokens,
            "token_count_chunks": chunk_tokens,
            "speaker_count": len(speakers),
            "turn_count": turn_count,
            "wpm": wpm,
            "host_share": None,  # filled in coverage block (task 8)
            "fireworks_cost_usd": (
                float(er.fireworks_stt_cost_usd) if er.fireworks_stt_cost_usd else None
            ),
            "transcribe_duration_secs": er.transcribe_duration_secs,
            "diarize_duration_secs": er.diarize_duration_secs,
            "inference_provider_used": er.inference_provider_used,
        })
    return out


def _roll_up_feed_text_totals(per_feed: list[dict], per_ep: list[dict]) -> None:
    """Sum per_episode word/token totals into per_feed entries (mutates in place)."""
    totals: dict[str, dict[str, int]] = {}
    for ep in per_ep:
        t = totals.setdefault(
            ep["feed_id"],
            {"words": 0, "seg": 0, "chunks": 0},
        )
        t["words"] += ep["word_count"]
        t["seg"] += ep["token_count_segments"]
        t["chunks"] += ep["token_count_chunks"]

    for f in per_feed:
        t = totals.get(f["feed_id"], {"words": 0, "seg": 0, "chunks": 0})
        f["total_words"] = t["words"]
        f["total_tokens_segments"] = t["seg"]
        f["total_tokens_chunks"] = t["chunks"]


def _per_speaker(db: Session) -> list[dict[str, Any]]:
    """Per-speaker aggregates across the corpus.

    Only includes speaker_names rows with confirmed_by_user=True OR
    confidence='HIGH' — per spec inclusion rule.
    """
    sn_rows = db.execute(
        select(
            SpeakerName.episode_id,
            SpeakerName.speaker_label,
            SpeakerName.display_name,
        ).where(
            (SpeakerName.confirmed_by_user == True)  # noqa: E712
            | (SpeakerName.confidence == "HIGH")
        )
    ).all()
    label_name_map: dict[tuple[str, str], str] = {
        (r.episode_id, r.speaker_label): r.display_name for r in sn_rows
    }

    # Dashboard is feed-centric; manual uploads (feed_id IS NULL) are out of
    # scope. Filtering here keeps None out of per-speaker feed_id aggregate
    # keys, which would otherwise break the deterministic sort below.
    ep_rows = db.execute(
        select(Episode.id, Episode.feed_id).where(
            Episode.status == "done", Episode.feed_id.isnot(None)
        )
    ).all()
    ep_feed: dict[str, str] = {r.id: r.feed_id for r in ep_rows}

    # Deterministic order is required: turn_count is computed by walking the
    # segment stream and incrementing when speaker changes vs the previous
    # row. Without ORDER BY, row order is engine-dependent and turn_count
    # becomes non-reproducible across runs.
    seg_rows = db.execute(
        select(
            Segment.episode_id, Segment.speaker_label, Segment.text,
            Segment.start_time, Segment.end_time,
        ).order_by(Segment.episode_id, Segment.start_time)
    ).all()

    agg: dict[tuple[str, str], dict[str, Any]] = {}
    last_speaker_per_ep: dict[str, str | None] = {}

    for s in seg_rows:
        if s.episode_id not in ep_feed:
            continue
        name = label_name_map.get((s.episode_id, s.speaker_label))
        if not name:
            continue
        feed_id = ep_feed[s.episode_id]
        # Use canonical normalization (matches feed_speaker_cache.normalized_name
        # per PRD-04) so "Alice" / "alice" / "Dr. Alice" collapse to one key.
        normalized = normalize_name(name)
        if not normalized:
            continue
        key = (feed_id, normalized)
        entry = agg.setdefault(key, {
            "speaker_display_name": name.strip(),
            "normalized_name": normalized,
            "feed_id": feed_id,
            "episode_ids": set(),
            "total_words": 0,
            "total_seconds": 0.0,
            "turn_count": 0,
        })
        entry["episode_ids"].add(s.episode_id)
        entry["total_words"] += len(s.text.split())
        entry["total_seconds"] += max(0.0, s.end_time - s.start_time)
        prev = last_speaker_per_ep.get(s.episode_id)
        if prev != normalized:
            entry["turn_count"] += 1
        last_speaker_per_ep[s.episode_id] = normalized

    out = []
    for entry in agg.values():
        total_sec = entry["total_seconds"]
        wpm = round(entry["total_words"] / (total_sec / 60.0), 1) if total_sec > 0 else 0.0
        episode_ids = sorted(entry["episode_ids"])
        out.append({
            **entry,
            "episode_ids": episode_ids,
            "episode_count": len(episode_ids),
            "wpm": wpm,
            "total_seconds": round(total_sec, 1),
        })
    # Stable output ordering for deterministic snapshot JSON.
    out.sort(key=lambda e: (e["feed_id"], e["normalized_name"]))
    return out


def _per_episode_speaker(db: Session) -> list[dict[str, Any]]:
    """Per-(episode, speaker, source) aggregates for PRD-06 plots.

    Returns one row per unique (episode_id, display_name, source) triple with:
      feed_id, feed_title, episode_id, episode_title, published_at (ISO 8601 or None),
      display_name, role ("host"|"guest" for confirmed; None for inferred_high),
      source ("confirmed"|"inferred_high"), minutes (float), words (int).

    Source predicates:
      confirmed      — confirmed_by_user=True AND role IN ('host', 'guest')
      inferred_high  — inferred=True AND confidence='HIGH'

    Only episodes with published_at IS NOT NULL are included.
    Output is sorted by (feed_title, published_at or "", display_name, source).
    """
    sn_pred = or_(
        and_(
            SpeakerName.confirmed_by_user == True,  # noqa: E712
            SpeakerName.role.in_(("host", "guest")),
        ),
        and_(
            SpeakerName.inferred == True,  # noqa: E712
            SpeakerName.confidence == "HIGH",
        ),
    )
    source_expr = case(
        (SpeakerName.confirmed_by_user == True, "confirmed"),  # noqa: E712
        else_="inferred_high",
    ).label("source")

    seg_rows = db.execute(
        select(
            Feed.id.label("feed_id"),
            Feed.title.label("feed_title"),
            Episode.id.label("episode_id"),
            Episode.title.label("episode_title"),
            Episode.published_at,
            SpeakerName.display_name,
            SpeakerName.role,
            source_expr,
            Segment.start_time,
            Segment.end_time,
            Segment.text,
        )
        .select_from(Segment)
        .join(Episode, Episode.id == Segment.episode_id)
        .join(Feed, Feed.id == Episode.feed_id)
        .join(
            SpeakerName,
            and_(
                SpeakerName.episode_id == Segment.episode_id,
                SpeakerName.speaker_label == Segment.speaker_label,
            ),
        )
        .where(Episode.published_at.isnot(None))
        .where(sn_pred)
    ).all()

    # Aggregate minutes + words per (feed_id, episode_id, display_name, source).
    agg: dict[tuple[str, str, str, str], dict[str, Any]] = {}
    for s in seg_rows:
        key = (s.feed_id, s.episode_id, s.display_name, s.source)
        if key not in agg:
            pub = s.published_at.isoformat() if s.published_at else None
            agg[key] = {
                "feed_id": s.feed_id,
                "feed_title": s.feed_title or "",
                "episode_id": s.episode_id,
                "episode_title": s.episode_title or "",
                "published_at": pub,
                "display_name": s.display_name,
                "role": s.role,
                "source": s.source,
                "minutes": 0.0,
                "words": 0,
            }
        entry = agg[key]
        entry["minutes"] += max(0.0, s.end_time - s.start_time) / 60.0
        entry["words"] += len(s.text.split()) if s.text else 0

    out = list(agg.values())
    out.sort(key=lambda r: (
        r["feed_title"],
        r["published_at"] or "",
        r["display_name"],
        r["source"],
    ))
    return out


def _identify_feed_host(feed: Feed, feed_speaker_cache_top: dict[str, str]) -> str | None:
    """Resolve host display name for a feed. Order per spec:
       feed_speaker_cache top entry → podcast_persons role=host →
       itunes_owner_name → itunes_author.
    """
    top = feed_speaker_cache_top.get(feed.id)
    if top:
        return top
    for p in (feed.podcast_persons or []):
        if isinstance(p, dict) and (p.get("role") or "").lower() == "host":
            name = p.get("name")
            if name:
                return name
    return feed.itunes_owner_name or feed.itunes_author


def _host_speaker_label_for_episode(
    episode_id: str,
    host_name: str,
    sn_by_ep: dict[str, list[SpeakerName]],
) -> str | None:
    """Return the speaker_label in the episode whose display_name matches
    host_name with confirmed=True or confidence='HIGH'."""
    host_norm = normalize_name(host_name)
    if not host_norm:
        return None
    for sn in sn_by_ep.get(episode_id, []):
        if (sn.confirmed_by_user or sn.confidence == "HIGH") \
                and normalize_name(sn.display_name) == host_norm:
            return sn.speaker_label
    return None


def _coverage_and_host_share(
    db: Session, per_ep: list[dict], per_feed_rows: list[dict]
) -> dict[str, Any]:
    """Compute the coverage block AND fills host_share in per_ep entries."""
    feeds = {f.id: f for f in db.execute(select(Feed)).scalars().all()}

    from app.models import FeedSpeakerCache
    fsc_rows = db.execute(
        select(FeedSpeakerCache.feed_id, FeedSpeakerCache.display_name,
               FeedSpeakerCache.occurrence_count)
        .order_by(FeedSpeakerCache.feed_id, FeedSpeakerCache.occurrence_count.desc())
    ).all()
    fsc_top: dict[str, str] = {}
    for r in fsc_rows:
        fsc_top.setdefault(r.feed_id, r.display_name)

    sn_rows = db.execute(select(SpeakerName)).scalars().all()
    sn_by_ep: dict[str, list[SpeakerName]] = {}
    for sn in sn_rows:
        sn_by_ep.setdefault(sn.episode_id, []).append(sn)

    seg_rows = db.execute(select(
        Segment.episode_id, Segment.speaker_label,
        Segment.start_time, Segment.end_time,
    )).all()
    seg_by_ep: dict[str, list] = {}
    for s in seg_rows:
        seg_by_ep.setdefault(s.episode_id, []).append(s)

    chunk_eps = {
        c.episode_id for c in db.execute(select(Chunk.episode_id).distinct()).all()
    }

    host_share_included: list[dict] = []
    host_share_excluded: list[dict] = []
    tokens_chunks_included: list[str] = []
    tokens_chunks_excluded: list[dict] = []
    wpm_speaker_included = 0
    wpm_speaker_excluded: list[dict] = []

    feed_title = {f_id: f.title or "(untitled)" for f_id, f in feeds.items()}
    feed_host = {f_id: _identify_feed_host(f, fsc_top) for f_id, f in feeds.items()}
    for f in per_feed_rows:
        f["inferred_host_name"] = feed_host.get(f["feed_id"])

    ep_titles = {
        r.id: r.title
        for r in db.execute(select(Episode.id, Episode.title)).all()
    }

    for ep in per_ep:
        ep_id = ep["episode_id"]
        feed_id = ep["feed_id"]
        title = ep_titles.get(ep_id) or "(untitled)"

        # tokens_chunks coverage
        if ep_id in chunk_eps:
            tokens_chunks_included.append(ep_id)
        else:
            tokens_chunks_excluded.append({
                "episode_id": ep_id, "feed_id": feed_id,
                "feed_title": feed_title.get(feed_id, ""),
                "title": title, "reason": "no chunks yet",
            })

        # host_share computation
        host_name = feed_host.get(feed_id)
        if not host_name:
            host_share_excluded.append({
                "episode_id": ep_id, "feed_id": feed_id,
                "feed_title": feed_title.get(feed_id, ""),
                "title": title, "reason": "feed has no identified host",
            })
        else:
            host_label = _host_speaker_label_for_episode(ep_id, host_name, sn_by_ep)
            if not host_label:
                host_share_excluded.append({
                    "episode_id": ep_id, "feed_id": feed_id,
                    "feed_title": feed_title.get(feed_id, ""),
                    "title": title, "reason": "no confirmed host in episode",
                })
            else:
                segs = seg_by_ep.get(ep_id, [])
                total_sec = sum(max(0.0, s.end_time - s.start_time) for s in segs)
                host_sec = sum(
                    max(0.0, s.end_time - s.start_time) for s in segs
                    if s.speaker_label == host_label
                )
                ep["host_share"] = (
                    round(host_sec / total_sec, 3) if total_sec > 0 else None
                )
                host_share_included.append({"episode_id": ep_id})

        # wpm_speaker coverage — included if any confirmed/HIGH speaker in episode
        has_confirmed = any(
            sn.confirmed_by_user or sn.confidence == "HIGH"
            for sn in sn_by_ep.get(ep_id, [])
        )
        if has_confirmed:
            wpm_speaker_included += 1
        else:
            wpm_speaker_excluded.append({
                "episode_id": ep_id, "feed_id": feed_id,
                "feed_title": feed_title.get(feed_id, ""),
                "title": title, "reason": "no confirmed/HIGH speakers",
            })

    return {
        "host_share": {
            "included_count": len(host_share_included),
            "excluded": host_share_excluded,
        },
        "wpm_speaker": {
            "included_count": wpm_speaker_included,
            "excluded": wpm_speaker_excluded,
        },
        "tokens_chunks": {
            "included_count": len(tokens_chunks_included),
            "excluded": tokens_chunks_excluded,
        },
    }


HOST_THRESHOLD = 0.25  # PRD-06 §3.3 — 25%-of-episodes fallback for inferred speakers


def _confirmed_role_map(speakers: list[dict[str, Any]]) -> dict[tuple, bool]:
    """Build a (feed_id, display_name) → is_host map from confirmed rows.

    Only considers rows with source == "confirmed". When a name has
    conflicting roles across episodes (e.g. labelled "host" in one and
    "guest" in another), the majority wins; ties break toward host=True.
    """
    # Accumulate (host_count, guest_count) per (feed_id, display_name).
    counts: dict[tuple, list[int]] = {}
    for row in speakers:
        if row["source"] != "confirmed":
            continue
        key = (row["feed_id"], row["display_name"])
        entry = counts.setdefault(key, [0, 0])  # [host_votes, guest_votes]
        if row["role"] == "host":
            entry[0] += 1
        elif row["role"] == "guest":
            entry[1] += 1

    # Majority wins; ties → host.
    return {key: (h >= g) for key, (h, g) in counts.items()}


def _episode_speaker_diff(speakers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-(feed, episode, source) host-vs-guest diff rows.

    Input is the output of _per_episode_speaker(). Returns one row per
    (feed_id, episode_id, source) where the episode has at least one host
    AND at least one guest after classification.

    Classification rules (PRD-06 §3.3):
      confirmed rows    — use _confirmed_role_map majority-vote result.
      inferred_high rows — inherit from _confirmed_role_map if present;
                           else fall back to HOST_THRESHOLD heuristic.
    """
    confirmed_map = _confirmed_role_map(speakers)

    # For the inferred heuristic we need:
    #   feed_episodes: total distinct episode_ids per feed (inferred source only).
    #   speaker_episodes: distinct episode_ids per (feed, display_name) (inferred).
    feed_ep_sets: dict[str, set[str]] = {}
    speaker_ep_sets: dict[tuple, set[str]] = {}
    for row in speakers:
        if row["source"] != "inferred_high":
            continue
        fid = row["feed_id"]
        eid = row["episode_id"]
        feed_ep_sets.setdefault(fid, set()).add(eid)
        key = (fid, row["display_name"])
        speaker_ep_sets.setdefault(key, set()).add(eid)

    def _is_host_inferred(feed_id: str, display_name: str) -> bool:
        key = (feed_id, display_name)
        # Inheritance from confirmed map.
        if key in confirmed_map:
            return confirmed_map[key]
        # Heuristic fallback.
        n_speaker = len(speaker_ep_sets.get(key, set()))
        n_feed = len(feed_ep_sets.get(feed_id, set()))
        if n_feed == 0:
            return False
        return (n_speaker / n_feed) >= HOST_THRESHOLD

    # Classify each speaker row and bucket by (feed_id, episode_id, source).
    # Each bucket entry: hosts list and guests list of minutes values.
    Bucket = dict[str, Any]
    buckets: dict[tuple, Bucket] = {}

    for row in speakers:
        fid = row["feed_id"]
        eid = row["episode_id"]
        src = row["source"]

        if src == "confirmed":
            is_host = confirmed_map.get((fid, row["display_name"]), False)
        elif src == "inferred_high":
            is_host = _is_host_inferred(fid, row["display_name"])
        else:
            continue

        bkey = (fid, eid, src)
        if bkey not in buckets:
            buckets[bkey] = {
                "feed_id": fid,
                "feed_title": row["feed_title"],
                "episode_id": eid,
                "episode_title": row["episode_title"],
                "published_at": row["published_at"],
                "source": src,
                "hosts": [],   # list of (display_name, minutes)
                "guests": [],  # list of (display_name, minutes)
            }
        b = buckets[bkey]
        entry = (row["display_name"], row["minutes"])
        if is_host:
            b["hosts"].append(entry)
        else:
            b["guests"].append(entry)

    out = []
    for b in buckets.values():
        hosts = b["hosts"]
        guests = b["guests"]
        if not hosts or not guests:
            continue  # must have at least one of each

        host_mins = [m for _, m in hosts]
        guest_mins = [m for _, m in guests]

        host_mean = sum(host_mins) / len(host_mins)
        host_min = min(host_mins)
        host_max = max(host_mins)
        guest_mean = sum(guest_mins) / len(guest_mins)
        guest_min = min(guest_mins)
        guest_max = max(guest_mins)

        out.append({
            "feed_id": b["feed_id"],
            "feed_title": b["feed_title"],
            "episode_id": b["episode_id"],
            "episode_title": b["episode_title"],
            "published_at": b["published_at"],
            "source": b["source"],
            "host_mean": host_mean,
            "host_min": host_min,
            "host_max": host_max,
            "host_count": len(hosts),
            "host_names": sorted({name for name, _ in hosts}),
            "guest_mean": guest_mean,
            "guest_min": guest_min,
            "guest_max": guest_max,
            "guest_count": len(guests),
            "guest_names": sorted({name for name, _ in guests}),
            "diff": guest_mean - host_mean,
            "band_lo": guest_min - host_max,
            "band_hi": guest_max - host_min,
        })

    out.sort(key=lambda r: (r["feed_title"], r["published_at"] or "", r["source"]))
    return out


def _timeline_monthly(db: Session, per_ep: list[dict]) -> list[dict[str, Any]]:
    """Monthly aggregates per feed, derived from the per_episode list."""
    buckets: dict[tuple[str, str], dict[str, Any]] = {}
    for ep in per_ep:
        if not ep["published_at"]:
            continue
        # published_at is ISO 8601 already; first 7 chars = YYYY-MM
        month = ep["published_at"][:7]
        key = (ep["feed_id"], month)
        b = buckets.setdefault(key, {
            "month": month,
            "feed_id": ep["feed_id"],
            "episode_count": 0,
            "total_words": 0,
            "total_duration_min": 0.0,
        })
        b["episode_count"] += 1
        b["total_words"] += ep["word_count"]
        b["total_duration_min"] += (ep["duration_secs"] or 0) / 60.0

    return [
        {**b, "total_duration_min": round(b["total_duration_min"], 2)}
        for b in sorted(buckets.values(), key=lambda x: (x["feed_id"], x["month"]))
    ]
