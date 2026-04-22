"""Meta-analysis dashboard service (Issue #521).

Computes the JSONB snapshot consumed by the /meta-analysis web page.
Also owns the stale-flag helpers that gate recomputation.
"""
import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Chunk, Episode, Feed, Segment, SpeakerName, SystemState
from app.services.inference_helpers import normalize_name

logger = logging.getLogger(__name__)

STALE_KEY = "meta_analysis_stale"


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


def is_stale(db: Session) -> bool:
    row = db.query(SystemState).filter(SystemState.key == STALE_KEY).one_or_none()
    return row is not None and row.value == "true"


def set_stale(db: Session) -> None:
    stmt = insert(SystemState).values(key=STALE_KEY, value="true")
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": "true"}
    )
    db.execute(stmt)
    db.commit()


def clear_stale(db: Session) -> None:
    stmt = insert(SystemState).values(key=STALE_KEY, value="false")
    stmt = stmt.on_conflict_do_update(
        index_elements=["key"], set_={"value": "false"}
    )
    db.execute(stmt)
    db.commit()


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
        ).where(Episode.status == "done")
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

    ep_rows = db.execute(
        select(Episode.id, Episode.feed_id).where(Episode.status == "done")
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
    host_norm = host_name.strip().lower()
    for sn in sn_by_ep.get(episode_id, []):
        if (sn.confirmed_by_user or sn.confidence == "HIGH") \
                and sn.display_name.strip().lower() == host_norm:
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


def compute_snapshot(db: Session) -> dict[str, Any]:
    """Compute the full meta-analysis snapshot dict."""
    per_ep = _per_episode(db)
    per_feed = _per_feed(db)
    _roll_up_feed_text_totals(per_feed, per_ep)
    coverage = _coverage_and_host_share(db, per_ep, per_feed)
    return {
        "per_feed": per_feed,
        "per_episode": per_ep,
        "per_speaker": _per_speaker(db),
        "timeline_monthly": _timeline_monthly(db, per_ep),
        "coverage": coverage,
    }
