"""Meta-analysis dashboard service (Issue #521).

Computes the JSONB snapshot consumed by the /meta-analysis web page.
Also owns the stale-flag helpers that gate recomputation.
"""
import logging
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import Chunk, Episode, Feed, Segment, SystemState

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
        seg_tokens = sum(_count_tokens(s.text) for s in segs) if _TOKENIZER_AVAILABLE else None
        chunk_tokens = (
            sum(_count_tokens(t) for t in chunk_text_by_ep.get(er.id, []))
            if _TOKENIZER_AVAILABLE else None
        )
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
            "token_count_segments": seg_tokens or 0,
            "token_count_chunks": chunk_tokens or 0,
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


def compute_snapshot(db: Session) -> dict[str, Any]:
    """Compute the full meta-analysis snapshot dict."""
    per_ep = _per_episode(db)
    per_feed = _per_feed(db)
    _roll_up_feed_text_totals(per_feed, per_ep)
    return {
        "per_feed": per_feed,
        "per_episode": per_ep,
        "per_speaker": [],
        "timeline_monthly": [],
        "coverage": {},
    }
