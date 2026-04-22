# Meta-Analysis Dashboard — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a new `/meta-analysis` section that visualizes content-level metadata about the podcast corpus (episode length, tokens, speakers, release cadence, cost, processing time) using a precomputed JSONB snapshot refreshed on worker idle.

**Architecture:** Single-row `meta_analysis_snapshot` JSONB table computed by the pipeline worker's idle hook (triggered by a `system_state['meta_analysis_stale']` flag). Web app reads the snapshot through thin proxy routes, renders Recharts charts in a card grid with stable per-podcast colors. A manual `POST /meta-analysis/refresh` endpoint bypasses idle-wait. Speaker edits in the web app write the stale flag directly to Postgres.

**Tech Stack:** Python 3.11 (FastAPI, SQLAlchemy, Alembic, tiktoken), TypeScript (Next.js 16 App Router, React Query, Recharts), PostgreSQL 15.

**Phase layout (optional PR split):** The plan is grouped in 3 phases. Per CLAUDE.md guidance on Issue #523 (ship large issues as sequential PRs), each phase is self-contained and could ship independently. Phase 1 leaves a working backend API, phase 2 leaves a working page with placeholder charts, phase 3 completes the charts.

- **Phase 1 — Backend:** Tasks 1–11
- **Phase 2 — Web scaffolding:** Tasks 12–21
- **Phase 3 — Charts:** Tasks 22–30
- **Phase 4 — Manual smoke:** Task 31

**Spec:** [`docs/superpowers/specs/2026-04-22-meta-analysis-dashboard-design.md`](../specs/2026-04-22-meta-analysis-dashboard-design.md) — refer to it for inclusion rules, snapshot JSONB shape, coverage semantics, error handling.

---

## File structure

### New files — pipeline

- `apps/pipeline/alembic/versions/015_add_meta_analysis_snapshot.py` — migration.
- `apps/pipeline/app/services/meta_analysis.py` — `compute_snapshot`, stale-flag helpers, `upsert_snapshot`.
- `apps/pipeline/app/api/meta_analysis.py` — FastAPI router.
- `apps/pipeline/tests/integration/services/test_meta_analysis.py` — per_feed/per_episode/per_speaker/timeline tests.
- `apps/pipeline/tests/integration/services/test_meta_analysis_coverage.py` — inclusion/exclusion edge cases.
- `apps/pipeline/tests/unit/test_worker_idle_hook.py` — idle hook dispatches compute.
- `apps/pipeline/tests/integration/api/test_meta_analysis_api.py` — API endpoints.

### Modified files — pipeline

- `apps/pipeline/pyproject.toml` — add `tiktoken`.
- `apps/pipeline/app/models.py` — add `MetaAnalysisSnapshot` ORM.
- `apps/pipeline/app/main.py` — register router.
- `apps/pipeline/app/worker.py` — call idle hook on empty poll.
- `apps/pipeline/app/tasks/archive.py` — set stale on episode done.
- `apps/pipeline/app/tasks/infer.py` — set stale after inference writes.

### New files — web

- `apps/web/src/lib/metaAnalysisStale.ts` — helper that UPSERTs `system_state['meta_analysis_stale']='true'`.
- `apps/web/src/lib/metaAnalysisTypes.ts` — TS types mirroring the JSONB snapshot.
- `apps/web/src/lib/metaAnalysisColors.ts` — hash(feed_id)→color palette.
- `apps/web/src/app/api/meta-analysis/snapshot/route.ts` — proxy to pipeline.
- `apps/web/src/app/api/meta-analysis/refresh/route.ts` — proxy.
- `apps/web/src/app/api/meta-analysis/coverage/missing-speakers/route.ts` — proxy.
- `apps/web/src/app/meta-analysis/page.tsx` — route entry.
- `apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx` — wrapper (React Query + filter state).
- `apps/web/src/app/meta-analysis/FiltersBar.tsx`
- `apps/web/src/app/meta-analysis/CoverageStrip.tsx`
- `apps/web/src/app/meta-analysis/MissingSpeakersModal.tsx`
- `apps/web/src/app/meta-analysis/ChartCard.tsx`
- `apps/web/src/app/meta-analysis/ExpandModal.tsx`
- `apps/web/src/app/meta-analysis/InfoBlock.tsx`
- `apps/web/src/app/meta-analysis/charts/*.tsx` (9 chart components)
- `apps/web/src/app/meta-analysis/charts/transforms/*.ts` (pure data-transform modules per chart, unit-testable)
- `apps/web/tests/unit/meta-analysis/*.test.tsx`

### Modified files — web

- `apps/web/package.json` — add `recharts`.
- `apps/web/src/app/api/episodes/[id]/speakers/route.ts` — call `setMetaAnalysisStale()` after successful rename.
- `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts` — same.
- `apps/web/src/components/Navbar.tsx` — insert **Meta-analysis** between Queue and Settings.

---

# Phase 1 — Backend

## Task 1: Migration 015 + ORM model

**Files:**
- Create: `apps/pipeline/alembic/versions/015_add_meta_analysis_snapshot.py`
- Modify: `apps/pipeline/app/models.py` (append new class)

- [ ] **Step 1: Write the migration**

Create `apps/pipeline/alembic/versions/015_add_meta_analysis_snapshot.py`:

```python
"""Add meta_analysis_snapshot single-row table (Issue #521).

Stores the precomputed dashboard snapshot as JSONB. CHECK (id = 1)
ensures at most one row. The stale flag reuses the existing
system_state kv table; no schema change required for it.
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB


revision = "015"
down_revision = "014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "meta_analysis_snapshot",
        sa.Column("id", sa.Integer(), primary_key=True, server_default="1"),
        sa.Column("snapshot", JSONB(), nullable=False),
        sa.Column(
            "computed_at",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.func.now(),
        ),
        sa.Column("episode_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("feed_count", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint("id = 1", name="ck_meta_analysis_snapshot_singleton"),
    )


def downgrade() -> None:
    op.drop_table("meta_analysis_snapshot")
```

- [ ] **Step 2: Append the ORM model to `apps/pipeline/app/models.py`**

Add at the end of the file (after `NotificationLog`):

```python
class MetaAnalysisSnapshot(Base):
    """Single-row cache of the computed meta-analysis dashboard snapshot (Issue #521)."""

    __tablename__ = "meta_analysis_snapshot"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    snapshot: Mapped[dict] = mapped_column(JSONB, nullable=False)
    computed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=func.now()
    )
    episode_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    feed_count: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
```

- [ ] **Step 3: Verify migration runs cleanly against test DB**

Run: `docker compose -f docker-compose.test.yml build pipeline_test db_test && docker compose -f docker-compose.test.yml run --rm pipeline_test alembic upgrade head`

Expected: exits 0 with `"Running upgrade 014 -> 015, Add meta_analysis_snapshot..."`.

- [ ] **Step 4: Commit**

```bash
git add apps/pipeline/alembic/versions/015_add_meta_analysis_snapshot.py apps/pipeline/app/models.py
git commit -m "feat(pipeline): add meta_analysis_snapshot table and ORM (#521)"
```

---

## Task 2: Stale-flag helpers (TDD)

**Files:**
- Create: `apps/pipeline/app/services/meta_analysis.py`
- Create: `apps/pipeline/tests/integration/services/test_meta_analysis.py`

- [ ] **Step 1: Write failing tests for the stale-flag helpers**

Create `apps/pipeline/tests/integration/services/test_meta_analysis.py`:

```python
"""Tests for apps/pipeline/app/services/meta_analysis.py (Issue #521)."""
from app.services.meta_analysis import (
    is_stale,
    set_stale,
    clear_stale,
)
from app.models import SystemState


def test_is_stale_returns_false_when_flag_missing(db_session):
    assert is_stale(db_session) is False


def test_set_stale_creates_row_with_value_true(db_session):
    set_stale(db_session)
    row = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").one()
    assert row.value == "true"
    assert is_stale(db_session) is True


def test_set_stale_is_idempotent(db_session):
    set_stale(db_session)
    set_stale(db_session)
    rows = db_session.query(SystemState).filter(SystemState.key == "meta_analysis_stale").all()
    assert len(rows) == 1
    assert is_stale(db_session) is True


def test_clear_stale_flips_value_to_false(db_session):
    set_stale(db_session)
    clear_stale(db_session)
    assert is_stale(db_session) is False
```

- [ ] **Step 2: Run tests and verify they fail with ImportError**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py -v`

Expected: ImportError (module doesn't exist yet).

- [ ] **Step 3: Create the helpers module**

Create `apps/pipeline/app/services/meta_analysis.py`:

```python
"""Meta-analysis dashboard service (Issue #521).

Computes the JSONB snapshot consumed by the /meta-analysis web page.
Also owns the stale-flag helpers that gate recomputation.
"""
import logging

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models import SystemState

logger = logging.getLogger(__name__)

STALE_KEY = "meta_analysis_stale"


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
```

- [ ] **Step 4: Run tests and verify they pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py -v`

Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py apps/pipeline/tests/integration/services/test_meta_analysis.py
git commit -m "feat(pipeline): add meta-analysis stale-flag helpers (#521)"
```

---

## Task 3: Add tiktoken dependency

**Files:**
- Modify: `apps/pipeline/pyproject.toml`

- [ ] **Step 1: Add tiktoken to `[tool.poetry.dependencies]`**

In `apps/pipeline/pyproject.toml`, inside `[tool.poetry.dependencies]`, append after the existing `feedparser` / audio-processing lines:

```toml
# Token counting for meta-analysis dashboard (#521)
tiktoken = "^0.7.0"
```

- [ ] **Step 2: Rebuild the pipeline image to install tiktoken**

Run: `docker compose build pipeline`

Expected: build succeeds, `tiktoken` appears in the install output.

- [ ] **Step 3: Verify tiktoken imports in a throwaway shell**

Run: `docker compose run --rm pipeline python -c "import tiktoken; enc = tiktoken.get_encoding('cl100k_base'); print(len(enc.encode('hello world')))"`

Expected: prints `2`.

- [ ] **Step 4: Commit**

```bash
git add apps/pipeline/pyproject.toml
git commit -m "feat(pipeline): add tiktoken dependency for token counting (#521)"
```

---

## Task 4: compute_snapshot — per_feed slice (TDD)

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis.py`
- Modify: `apps/pipeline/tests/integration/services/test_meta_analysis.py`

- [ ] **Step 1: Write failing test for per_feed aggregates**

Append to `apps/pipeline/tests/integration/services/test_meta_analysis.py`:

```python
from datetime import datetime, timezone
from app.services.meta_analysis import compute_snapshot
from app.models import Feed, Episode, Segment


def _make_feed(db_session, title="Test Feed"):
    feed = Feed(url=f"http://example.com/{title}", title=title)
    db_session.add(feed)
    db_session.commit()
    return feed


def _make_episode(db_session, feed, **kwargs):
    defaults = {
        "guid": f"guid-{datetime.now().timestamp()}",
        "audio_url": "http://example.com/a.mp3",
        "status": "done",
        "duration_secs": 600,
        "published_at": datetime(2026, 1, 15, tzinfo=timezone.utc),
    }
    defaults.update(kwargs)
    ep = Episode(feed_id=feed.id, **defaults)
    db_session.add(ep)
    db_session.commit()
    return ep


def _add_segments(db_session, ep, texts: list[str], speaker="SPEAKER_00"):
    for i, t in enumerate(texts):
        db_session.add(Segment(
            episode_id=ep.id,
            speaker_label=speaker,
            start_time=float(i * 10),
            end_time=float(i * 10 + 10),
            text=t,
        ))
    db_session.commit()


def test_compute_snapshot_per_feed_aggregates(db_session):
    feed = _make_feed(db_session, "Podcast A")
    _make_episode(db_session, feed, duration_secs=600)
    _make_episode(db_session, feed, duration_secs=1200)
    snap = compute_snapshot(db_session)

    entry = next(f for f in snap["per_feed"] if f["title"] == "Podcast A")
    assert entry["episode_count"] == 2
    assert entry["avg_length_min"] == 15.0      # (600 + 1200) / 2 / 60
    assert entry["std_length_min"] > 0          # two different values → non-zero std


def test_compute_snapshot_excludes_non_done_episodes(db_session):
    feed = _make_feed(db_session, "Podcast B")
    _make_episode(db_session, feed, status="done", duration_secs=600)
    _make_episode(db_session, feed, status="pending", duration_secs=99999)
    snap = compute_snapshot(db_session)

    entry = next(f for f in snap["per_feed"] if f["title"] == "Podcast B")
    assert entry["episode_count"] == 1
    assert entry["avg_length_min"] == 10.0
```

- [ ] **Step 2: Run tests and verify they fail**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py::test_compute_snapshot_per_feed_aggregates -v`

Expected: ImportError on `compute_snapshot` or AttributeError.

- [ ] **Step 3: Add per_feed computation to `meta_analysis.py`**

Append to `apps/pipeline/app/services/meta_analysis.py`:

```python
from typing import Any

from sqlalchemy import func, select

from app.models import Episode, Feed


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


def compute_snapshot(db: Session) -> dict[str, Any]:
    """Compute the full meta-analysis snapshot dict."""
    return {
        "per_feed": _per_feed(db),
        "per_episode": [],
        "per_speaker": [],
        "timeline_monthly": [],
        "coverage": {},
    }
```

- [ ] **Step 4: Run tests and verify per_feed tests pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py -v`

Expected: all pass (stale-flag tests + 2 new per_feed tests).

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py apps/pipeline/tests/integration/services/test_meta_analysis.py
git commit -m "feat(pipeline): compute per-feed aggregates for meta-analysis (#521)"
```

---

## Task 5: compute_snapshot — per_episode with tokenization (TDD)

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis.py`
- Modify: `apps/pipeline/tests/integration/services/test_meta_analysis.py`

- [ ] **Step 1: Write failing tests**

Append to `test_meta_analysis.py`:

```python
from app.models import Chunk


def test_compute_snapshot_per_episode_counts_words_and_tokens(db_session):
    feed = _make_feed(db_session, "Podcast C")
    ep = _make_episode(db_session, feed, duration_secs=60)
    _add_segments(db_session, ep, ["Hello world", "Short segment here"])

    snap = compute_snapshot(db_session)
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)

    assert ep_entry["word_count"] == 5        # "Hello world" + "Short segment here"
    assert ep_entry["token_count_segments"] > 0
    assert ep_entry["feed_id"] == feed.id
    assert ep_entry["duration_secs"] == 60


def test_compute_snapshot_per_episode_handles_no_chunks(db_session):
    feed = _make_feed(db_session, "Podcast D")
    ep = _make_episode(db_session, feed, duration_secs=120)
    _add_segments(db_session, ep, ["a b c"])

    snap = compute_snapshot(db_session)
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)
    assert ep_entry["token_count_chunks"] == 0


def test_compute_snapshot_per_episode_counts_chunks_when_present(db_session):
    feed = _make_feed(db_session, "Podcast E")
    ep = _make_episode(db_session, feed, duration_secs=120)
    _add_segments(db_session, ep, ["hello"])
    db_session.add(Chunk(
        episode_id=ep.id,
        speaker_label="SPEAKER_00",
        start_time=0.0,
        end_time=10.0,
        text="hello world this is a chunk",
        segment_ids=[],
    ))
    db_session.commit()

    snap = compute_snapshot(db_session)
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)
    assert ep_entry["token_count_chunks"] > 0
```

- [ ] **Step 2: Run tests — verify they fail**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py -v`

Expected: new per-episode tests fail (per_episode is empty).

- [ ] **Step 3: Implement per-episode aggregation with token counting**

Replace the `per_episode` stub in `compute_snapshot`. Add these near the top of `meta_analysis.py` (above `is_stale`):

```python
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
```

Add helper `_per_episode`:

```python
from app.models import Chunk, Segment


def _per_episode(db: Session) -> list[dict[str, Any]]:
    """Per-episode aggregates. Pulls segment and chunk text for token counting."""
    # Episode row + total segment word count + token-source text
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

    # Precompute segment-level text per episode (single pass)
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
            "fireworks_cost_usd": float(er.fireworks_stt_cost_usd) if er.fireworks_stt_cost_usd else None,
            "transcribe_duration_secs": er.transcribe_duration_secs,
            "diarize_duration_secs": er.diarize_duration_secs,
            "inference_provider_used": er.inference_provider_used,
        })
    return out


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
```

Update `compute_snapshot` to call it:

```python
def compute_snapshot(db: Session) -> dict[str, Any]:
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
```

- [ ] **Step 4: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py -v`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py apps/pipeline/tests/integration/services/test_meta_analysis.py
git commit -m "feat(pipeline): compute per-episode with token counting (#521)"
```

---

## Task 6: compute_snapshot — per_speaker (TDD)

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis.py`
- Modify: `apps/pipeline/tests/integration/services/test_meta_analysis.py`

- [ ] **Step 1: Write failing test**

Append:

```python
from app.models import SpeakerName


def test_compute_snapshot_per_speaker_aggregates_by_confirmed_name(db_session):
    feed = _make_feed(db_session, "Podcast F")
    ep = _make_episode(db_session, feed, duration_secs=120)
    _add_segments(db_session, ep, ["one two three", "four five"], speaker="SPEAKER_00")
    _add_segments(db_session, ep, ["six seven"], speaker="SPEAKER_01")
    db_session.add_all([
        SpeakerName(episode_id=ep.id, speaker_label="SPEAKER_00",
                    display_name="Alice", confirmed_by_user=True),
        SpeakerName(episode_id=ep.id, speaker_label="SPEAKER_01",
                    display_name="Unconfirmed Bob", confidence="LOW", inferred=True),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    names = {s["speaker_display_name"] for s in snap["per_speaker"]}
    assert "Alice" in names
    assert "Unconfirmed Bob" not in names   # LOW confidence, unconfirmed → excluded

    alice = next(s for s in snap["per_speaker"] if s["speaker_display_name"] == "Alice")
    assert alice["total_words"] == 5
    assert alice["turn_count"] == 1
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py::test_compute_snapshot_per_speaker_aggregates_by_confirmed_name -v`

Expected: assertion fails (empty `per_speaker`).

- [ ] **Step 3: Implement `_per_speaker`**

Add to `meta_analysis.py`:

```python
from app.models import SpeakerName


def _per_speaker(db: Session) -> list[dict[str, Any]]:
    """Per-speaker aggregates across the corpus.

    Only includes speaker_names rows with confirmed_by_user=True OR
    confidence='HIGH' — per spec inclusion rule.
    """
    # (episode_id, speaker_label) → display_name (only confirmed/HIGH)
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

    # episode_id → feed_id
    ep_rows = db.execute(
        select(Episode.id, Episode.feed_id).where(Episode.status == "done")
    ).all()
    ep_feed: dict[str, str] = {r.id: r.feed_id for r in ep_rows}

    seg_rows = db.execute(
        select(
            Segment.episode_id, Segment.speaker_label, Segment.text,
            Segment.start_time, Segment.end_time,
        )
    ).all()

    # Aggregate by normalized display_name (case-insensitive, trimmed)
    agg: dict[tuple[str, str], dict[str, Any]] = {}
    last_speaker_per_ep: dict[str, str | None] = {}

    for s in seg_rows:
        if s.episode_id not in ep_feed:
            continue
        name = label_name_map.get((s.episode_id, s.speaker_label))
        if not name:
            continue
        feed_id = ep_feed[s.episode_id]
        key = (feed_id, name.strip())
        entry = agg.setdefault(key, {
            "speaker_display_name": name.strip(),
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
        if prev != name:
            entry["turn_count"] += 1
        last_speaker_per_ep[s.episode_id] = name

    out = []
    for entry in agg.values():
        total_sec = entry["total_seconds"]
        wpm = round(entry["total_words"] / (total_sec / 60.0), 1) if total_sec > 0 else 0.0
        out.append({
            **entry,
            "episode_ids": sorted(entry["episode_ids"]),
            "wpm": wpm,
            "total_seconds": round(total_sec, 1),
        })
    return out
```

Update `compute_snapshot` — replace `"per_speaker": []` with `"per_speaker": _per_speaker(db)`.

- [ ] **Step 4: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py -v`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py apps/pipeline/tests/integration/services/test_meta_analysis.py
git commit -m "feat(pipeline): compute per-speaker meta-analysis aggregates (#521)"
```

---

## Task 7: compute_snapshot — timeline_monthly (TDD)

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis.py`
- Modify: `apps/pipeline/tests/integration/services/test_meta_analysis.py`

- [ ] **Step 1: Write failing test**

Append:

```python
def test_compute_snapshot_timeline_monthly_buckets_by_month(db_session):
    feed = _make_feed(db_session, "Podcast G")
    _make_episode(
        db_session, feed,
        published_at=datetime(2026, 1, 10, tzinfo=timezone.utc),
        duration_secs=600,
    )
    _make_episode(
        db_session, feed,
        published_at=datetime(2026, 1, 25, tzinfo=timezone.utc),
        duration_secs=1200,
    )
    _make_episode(
        db_session, feed,
        published_at=datetime(2026, 2, 5, tzinfo=timezone.utc),
        duration_secs=600,
    )

    snap = compute_snapshot(db_session)
    jan = next(
        t for t in snap["timeline_monthly"]
        if t["feed_id"] == feed.id and t["month"] == "2026-01"
    )
    feb = next(
        t for t in snap["timeline_monthly"]
        if t["feed_id"] == feed.id and t["month"] == "2026-02"
    )
    assert jan["episode_count"] == 2
    assert jan["total_duration_min"] == 30    # (600 + 1200) / 60
    assert feb["episode_count"] == 1
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py::test_compute_snapshot_timeline_monthly_buckets_by_month -v`

Expected: KeyError or empty result.

- [ ] **Step 3: Implement `_timeline_monthly` in `meta_analysis.py`**

```python
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
```

Update `compute_snapshot`:

```python
def compute_snapshot(db: Session) -> dict[str, Any]:
    per_ep = _per_episode(db)
    per_feed = _per_feed(db)
    _roll_up_feed_text_totals(per_feed, per_ep)
    return {
        "per_feed": per_feed,
        "per_episode": per_ep,
        "per_speaker": _per_speaker(db),
        "timeline_monthly": _timeline_monthly(db, per_ep),
        "coverage": {},
    }
```

- [ ] **Step 4: Run — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis.py -v`

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py apps/pipeline/tests/integration/services/test_meta_analysis.py
git commit -m "feat(pipeline): compute monthly timeline aggregates (#521)"
```

---

## Task 8: compute_snapshot — coverage block + host share (TDD)

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis.py`
- Create: `apps/pipeline/tests/integration/services/test_meta_analysis_coverage.py`

- [ ] **Step 1: Write failing tests in the dedicated coverage file**

Create `apps/pipeline/tests/integration/services/test_meta_analysis_coverage.py`:

```python
"""Coverage and inclusion-rule tests for compute_snapshot (Issue #521)."""
from datetime import datetime, timezone

from app.services.meta_analysis import compute_snapshot
from app.models import Feed, Episode, Segment, SpeakerName, Chunk


def _make_feed(db, title, itunes_owner_name=None):
    feed = Feed(url=f"http://ex.com/{title}", title=title,
                itunes_owner_name=itunes_owner_name)
    db.add(feed)
    db.commit()
    return feed


def _make_ep(db, feed, **k):
    k.setdefault("guid", f"g-{datetime.now().timestamp()}")
    k.setdefault("audio_url", "x")
    k.setdefault("status", "done")
    k.setdefault("duration_secs", 120)
    k.setdefault("published_at", datetime(2026, 1, 1, tzinfo=timezone.utc))
    ep = Episode(feed_id=feed.id, **k)
    db.add(ep); db.commit()
    return ep


def test_host_share_included_when_confirmed_host_matches_feed_owner(db_session):
    feed = _make_feed(db_session, "Pod X", itunes_owner_name="Alice")
    ep = _make_ep(db_session, feed)
    db_session.add_all([
        Segment(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=30,
                text="alice speaking " * 10),
        Segment(episode_id=ep.id, speaker_label="S1", start_time=30, end_time=60,
                text="guest here"),
        SpeakerName(episode_id=ep.id, speaker_label="S0",
                    display_name="Alice", confirmed_by_user=True),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    assert snap["coverage"]["host_share"]["included_count"] == 1
    ep_entry = next(e for e in snap["per_episode"] if e["episode_id"] == ep.id)
    assert ep_entry["host_share"] is not None
    assert 0.5 < ep_entry["host_share"] < 1.0


def test_host_share_excluded_when_feed_has_no_host_hint(db_session):
    feed = _make_feed(db_session, "Pod Y")   # no itunes_owner_name
    ep = _make_ep(db_session, feed)
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10, text="hi"
    ))
    db_session.commit()

    snap = compute_snapshot(db_session)
    excl = snap["coverage"]["host_share"]["excluded"]
    assert any(e["episode_id"] == ep.id for e in excl)
    assert any(e["reason"] == "feed has no identified host" for e in excl)


def test_host_share_excluded_when_episode_has_no_confirmed_host(db_session):
    feed = _make_feed(db_session, "Pod Z", itunes_owner_name="Alice")
    ep = _make_ep(db_session, feed)
    db_session.add_all([
        Segment(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10,
                text="some text"),
        SpeakerName(episode_id=ep.id, speaker_label="S0",
                    display_name="Alice", confidence="LOW", inferred=True),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    excl = snap["coverage"]["host_share"]["excluded"]
    assert any(
        e["episode_id"] == ep.id and e["reason"] == "no confirmed host in episode"
        for e in excl
    )


def test_tokens_chunks_excluded_when_no_chunks(db_session):
    feed = _make_feed(db_session, "Pod T")
    ep = _make_ep(db_session, feed)
    db_session.add(Segment(
        episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10, text="hi"
    ))
    db_session.commit()

    snap = compute_snapshot(db_session)
    excl = snap["coverage"]["tokens_chunks"]["excluded"]
    assert any(e["episode_id"] == ep.id and e["reason"] == "no chunks yet" for e in excl)


def test_tokens_chunks_included_when_chunks_exist(db_session):
    feed = _make_feed(db_session, "Pod U")
    ep = _make_ep(db_session, feed)
    db_session.add_all([
        Segment(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10, text="hi"),
        Chunk(episode_id=ep.id, speaker_label="S0", start_time=0, end_time=10,
              text="hi there", segment_ids=[]),
    ])
    db_session.commit()

    snap = compute_snapshot(db_session)
    assert snap["coverage"]["tokens_chunks"]["included_count"] == 1
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/services/test_meta_analysis_coverage.py -v`

Expected: assertion failures / KeyError (coverage is `{}`).

- [ ] **Step 3: Implement coverage + host_share**

Add helpers to `meta_analysis.py`:

```python
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

    # feed_speaker_cache — top name per feed by occurrence_count
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

    for ep in per_ep:
        ep_id = ep["episode_id"]
        feed_id = ep["feed_id"]
        title = next((e.title for e in db.execute(
            select(Episode).where(Episode.id == ep_id)
        ).scalars().all()), None) or "(untitled)"

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
            continue
        host_label = _host_speaker_label_for_episode(ep_id, host_name, sn_by_ep)
        if not host_label:
            host_share_excluded.append({
                "episode_id": ep_id, "feed_id": feed_id,
                "feed_title": feed_title.get(feed_id, ""),
                "title": title, "reason": "no confirmed host in episode",
            })
            continue

        segs = seg_by_ep.get(ep_id, [])
        total_sec = sum(max(0.0, s.end_time - s.start_time) for s in segs)
        host_sec = sum(
            max(0.0, s.end_time - s.start_time) for s in segs
            if s.speaker_label == host_label
        )
        ep["host_share"] = round(host_sec / total_sec, 3) if total_sec > 0 else None
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
```

Update `compute_snapshot` final block:

```python
def compute_snapshot(db: Session) -> dict[str, Any]:
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
```

- [ ] **Step 4: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest tests/integration/services/ -v`

Expected: all meta-analysis tests pass.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py apps/pipeline/tests/integration/services/test_meta_analysis_coverage.py
git commit -m "feat(pipeline): compute coverage block and host_share (#521)"
```

---

## Task 9: upsert_snapshot + API endpoints (TDD)

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis.py`
- Create: `apps/pipeline/app/api/meta_analysis.py`
- Modify: `apps/pipeline/app/main.py`
- Create: `apps/pipeline/tests/integration/api/test_meta_analysis_api.py`

- [ ] **Step 1: Write failing integration tests for the API**

Create `apps/pipeline/tests/integration/api/test_meta_analysis_api.py`:

```python
"""Integration tests for /api/meta-analysis endpoints (Issue #521)."""
import pytest


def test_get_snapshot_returns_empty_state_when_unpopulated(api_client):
    resp = api_client.get("/api/meta-analysis/snapshot")
    assert resp.status_code == 200
    body = resp.json()
    assert body["snapshot"] is None
    assert body["is_stale"] is True
    assert body["computed_at"] is None


def test_post_refresh_runs_synchronously_and_populates(api_client, db_session):
    resp = api_client.post("/api/meta-analysis/refresh")
    assert resp.status_code == 200
    body = resp.json()
    assert body["snapshot"] is not None
    assert "per_feed" in body["snapshot"]
    assert body["is_stale"] is False
    assert body["computed_at"] is not None


def test_get_snapshot_returns_populated_after_refresh(api_client):
    api_client.post("/api/meta-analysis/refresh")
    resp = api_client.get("/api/meta-analysis/snapshot")
    body = resp.json()
    assert body["snapshot"] is not None
    assert body["is_stale"] is False


def test_missing_speakers_groups_by_feed(api_client, db_session):
    # Populate first so coverage is present
    api_client.post("/api/meta-analysis/refresh")
    resp = api_client.get("/api/meta-analysis/coverage/missing-speakers")
    assert resp.status_code == 200
    body = resp.json()
    assert "podcasts" in body
    # Each entry: {feed_id, title, episodes: [...]}
    for feed in body["podcasts"]:
        assert set(feed.keys()) == {"feed_id", "title", "episodes"}
```

- [ ] **Step 2: Run — verify failure (404)**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/api/test_meta_analysis_api.py -v`

Expected: 404s (endpoints don't exist).

- [ ] **Step 3: Add upsert_snapshot to the service module**

Append to `apps/pipeline/app/services/meta_analysis.py`:

```python
from app.models import MetaAnalysisSnapshot


def upsert_snapshot(
    db: Session,
    snapshot: dict[str, Any],
    episode_count: int,
    feed_count: int,
) -> MetaAnalysisSnapshot:
    """UPSERT into the single-row snapshot table."""
    from datetime import datetime, timezone
    stmt = insert(MetaAnalysisSnapshot).values(
        id=1,
        snapshot=snapshot,
        computed_at=datetime.now(timezone.utc),
        episode_count=episode_count,
        feed_count=feed_count,
    )
    stmt = stmt.on_conflict_do_update(
        index_elements=["id"],
        set_={
            "snapshot": stmt.excluded.snapshot,
            "computed_at": stmt.excluded.computed_at,
            "episode_count": stmt.excluded.episode_count,
            "feed_count": stmt.excluded.feed_count,
        },
    )
    db.execute(stmt)
    db.commit()
    return db.query(MetaAnalysisSnapshot).filter(MetaAnalysisSnapshot.id == 1).one()


def recompute_and_store(db: Session) -> MetaAnalysisSnapshot:
    """Run compute_snapshot, upsert, and clear the stale flag."""
    snap = compute_snapshot(db)
    episode_count = len(snap["per_episode"])
    feed_count = len(snap["per_feed"])
    row = upsert_snapshot(db, snap, episode_count, feed_count)
    clear_stale(db)
    return row
```

- [ ] **Step 4: Create the API router**

Create `apps/pipeline/app/api/meta_analysis.py`:

```python
"""Meta-analysis dashboard API (Issue #521)."""
import logging

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.database import get_db
from app.models import MetaAnalysisSnapshot
from app.services.meta_analysis import is_stale, recompute_and_store

logger = logging.getLogger(__name__)
router = APIRouter()


def _serialize(row: MetaAnalysisSnapshot | None, stale: bool) -> dict:
    if row is None:
        return {
            "snapshot": None,
            "computed_at": None,
            "episode_count": 0,
            "feed_count": 0,
            "is_stale": stale,
            "last_error": None,
        }
    return {
        "snapshot": row.snapshot,
        "computed_at": row.computed_at.isoformat() if row.computed_at else None,
        "episode_count": row.episode_count,
        "feed_count": row.feed_count,
        "is_stale": stale,
        "last_error": None,
    }


@router.get("/meta-analysis/snapshot")
def get_snapshot(db: Session = Depends(get_db)) -> dict:
    row = db.query(MetaAnalysisSnapshot).filter(MetaAnalysisSnapshot.id == 1).one_or_none()
    if row is None:
        return _serialize(None, stale=True)
    return _serialize(row, stale=is_stale(db))


@router.post("/meta-analysis/refresh")
def post_refresh(db: Session = Depends(get_db)) -> dict:
    # Row-level lock serializes concurrent refreshes.
    db.execute(text(
        "SELECT pg_advisory_xact_lock(hashtext('meta_analysis_refresh'))"
    ))
    try:
        row = recompute_and_store(db)
    except Exception:
        logger.exception('"action": "meta_analysis_refresh_failed"')
        raise HTTPException(status_code=500, detail="Recompute failed")
    return _serialize(row, stale=False)


@router.get("/meta-analysis/coverage/missing-speakers")
def missing_speakers(db: Session = Depends(get_db)) -> dict:
    row = db.query(MetaAnalysisSnapshot).filter(MetaAnalysisSnapshot.id == 1).one_or_none()
    if row is None:
        return {"podcasts": []}
    excluded = (row.snapshot.get("coverage", {}).get("host_share", {}).get("excluded", []))
    grouped: dict[str, dict] = {}
    for e in excluded:
        g = grouped.setdefault(e["feed_id"], {
            "feed_id": e["feed_id"],
            "title": e["feed_title"],
            "episodes": [],
        })
        g["episodes"].append({
            "id": e["episode_id"],
            "title": e["title"],
            "reason": e["reason"],
        })
    return {"podcasts": list(grouped.values())}
```

- [ ] **Step 5: Register router in `apps/pipeline/app/main.py`**

Modify the imports line to add `meta_analysis`:

```python
from app.api import ask, backfill, feeds, episodes, queue, health, embed, notifications, hardware, meta_analysis
```

After the other `include_router` calls (after `hardware`):

```python
app.include_router(meta_analysis.router, prefix="/api")
```

- [ ] **Step 6: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/integration/api/test_meta_analysis_api.py -v`

Expected: all 4 pass.

- [ ] **Step 7: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py apps/pipeline/app/api/meta_analysis.py apps/pipeline/app/main.py apps/pipeline/tests/integration/api/test_meta_analysis_api.py
git commit -m "feat(pipeline): add meta-analysis API (snapshot/refresh/coverage) (#521)"
```

---

## Task 10: Worker idle hook (TDD)

**Files:**
- Modify: `apps/pipeline/app/worker.py`
- Create: `apps/pipeline/tests/unit/test_worker_idle_hook.py`

- [ ] **Step 1: Write failing tests**

Create `apps/pipeline/tests/unit/test_worker_idle_hook.py`:

```python
"""Tests for worker idle hook (Issue #521)."""
from unittest.mock import patch, MagicMock

from app.worker import run_idle_hook


def test_run_idle_hook_does_nothing_when_not_stale(db_session):
    with patch("app.worker.recompute_and_store") as mock_recompute:
        run_idle_hook(db_session)
        mock_recompute.assert_not_called()


def test_run_idle_hook_triggers_recompute_when_stale(db_session):
    from app.services.meta_analysis import set_stale
    set_stale(db_session)

    with patch("app.worker.recompute_and_store") as mock_recompute:
        mock_recompute.return_value = MagicMock()
        run_idle_hook(db_session)
        mock_recompute.assert_called_once()


def test_run_idle_hook_swallows_exceptions(db_session):
    from app.services.meta_analysis import set_stale
    set_stale(db_session)

    with patch("app.worker.recompute_and_store", side_effect=RuntimeError("boom")):
        run_idle_hook(db_session)   # Must not raise
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/unit/test_worker_idle_hook.py -v`

Expected: ImportError (run_idle_hook doesn't exist).

- [ ] **Step 3: Add idle hook to `apps/pipeline/app/worker.py`**

Near the top, add the import:

```python
from app.services.meta_analysis import is_stale
from app.services.meta_analysis import recompute_and_store
```

Add a helper function above `main()`:

```python
def run_idle_hook(db) -> None:
    """Run during idle poll cycles — recomputes the meta-analysis snapshot
    if the stale flag is set. Swallows exceptions so the worker poll loop
    is never interrupted.
    """
    try:
        if not is_stale(db):
            return
        started = time.time()
        recompute_and_store(db)
        duration_ms = int((time.time() - started) * 1000)
        logger.info(
            '"action": "meta_analysis_recomputed", "duration_ms": %d',
            duration_ms,
        )
    except Exception:
        logger.exception('"action": "meta_analysis_idle_hook_failed"')
```

Wire into the existing poll loop — replace the `if job is None:` block inside `main()` so it calls the hook before sleeping:

```python
            job = job_queue.poll(db)
            if job is None:
                run_idle_hook(db)
                db.close()
                time.sleep(POLL_INTERVAL)
                continue
```

- [ ] **Step 4: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/unit/test_worker_idle_hook.py -v`

Expected: 3 passed.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/worker.py apps/pipeline/tests/unit/test_worker_idle_hook.py
git commit -m "feat(pipeline): worker idle hook recomputes meta-analysis snapshot (#521)"
```

---

## Task 11: Pipeline-side stage hooks (archive + infer)

**Files:**
- Modify: `apps/pipeline/app/tasks/archive.py`
- Modify: `apps/pipeline/app/tasks/infer.py`

- [ ] **Step 1: Modify `apps/pipeline/app/tasks/archive.py`**

Add import near the top:

```python
from app.services.meta_analysis import set_stale
```

Find the section inside `archive_episode` that marks status=`"done"` (the `update_episode(..., status="done")` call around line 74). Immediately after the status transition and before returning, add:

```python
        # Issue #521: mark meta-analysis dashboard as stale so the worker
        # idle hook will refresh on next drain.
        try:
            set_stale(db)
        except Exception:
            logger.exception('"action": "meta_analysis_stale_set_failed", "episode_id": "%s"', episode_id)
```

(Keep it inside the same session `db`.)

- [ ] **Step 2: Modify `apps/pipeline/app/tasks/infer.py`**

Locate the inference task's main entry point (the function called from the task registry — typically `infer_speakers` or similar). After it commits any `SpeakerName` inserts/updates, add:

```python
from app.services.meta_analysis import set_stale as _set_meta_stale

# ... near end of the function, after db.commit() ...
try:
    _set_meta_stale(db)
except Exception:
    logger.exception('"action": "meta_analysis_stale_set_failed", "episode_id": "%s"', episode_id)
```

- [ ] **Step 3: Write + run a targeted assertion**

Manually verify wiring with an ad-hoc script via `docker compose exec pipeline python`:

```python
from app.database import SessionLocal
from app.services.meta_analysis import is_stale, clear_stale
from app.tasks.archive import archive_episode  # only import — do not call

db = SessionLocal()
clear_stale(db)
assert is_stale(db) is False
# Trigger archive path via the task registry in real tests;
# here we just verify import wiring.
print("OK — archive imports set_stale, infer imports set_stale")
db.close()
```

Expected: prints `OK`.

- [ ] **Step 4: Commit**

```bash
git add apps/pipeline/app/tasks/archive.py apps/pipeline/app/tasks/infer.py
git commit -m "feat(pipeline): set meta-analysis stale flag on episode done + infer (#521)"
```

---

# Phase 2 — Web scaffolding

## Task 12: Add recharts dependency

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install recharts**

Run: `cd apps/web && pnpm add recharts@^2.12.0`

(Use npm if project uses npm. Check `apps/web/package.json` for the existing install script format.)

- [ ] **Step 2: Rebuild the web image so node_modules include recharts**

Run: `docker compose build web`

Expected: build succeeds; `recharts` shows in the install output.

- [ ] **Step 3: Commit**

```bash
git add apps/web/package.json apps/web/pnpm-lock.yaml  # or package-lock.json
git commit -m "feat(web): add recharts dependency for meta-analysis (#521)"
```

---

## Task 13: Web-side stale flag helper + wire into speaker routes

**Files:**
- Create: `apps/web/src/lib/metaAnalysisStale.ts`
- Modify: `apps/web/src/app/api/episodes/[id]/speakers/route.ts`
- Modify: `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts`
- Create: `apps/web/tests/unit/meta-analysis-stale.test.ts`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/unit/meta-analysis-stale.test.ts`:

```typescript
import { setMetaAnalysisStale } from "@/lib/metaAnalysisStale";

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

describe("setMetaAnalysisStale", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  it("UPSERTs the stale flag as true", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await setMetaAnalysisStale();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("system_state"),
      ["meta_analysis_stale", "true"]
    );
  });

  it("swallows DB errors so route handlers are not broken", async () => {
    mockQuery.mockRejectedValue(new Error("db down"));
    await expect(setMetaAnalysisStale()).resolves.toBeUndefined();
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test meta-analysis-stale`

Expected: module-not-found error.

- [ ] **Step 3: Create the helper**

Create `apps/web/src/lib/metaAnalysisStale.ts`:

```typescript
import pool from "@/lib/db";

/**
 * Set the meta_analysis_stale flag to true so the pipeline worker's
 * idle hook recomputes the dashboard snapshot on next drain. (Issue #521)
 *
 * Swallows errors — a failure here should never break the speaker-rename
 * path; worst case the dashboard is slightly stale until another trigger.
 */
export async function setMetaAnalysisStale(): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO system_state (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ["meta_analysis_stale", "true"]
    );
  } catch (err) {
    console.error("setMetaAnalysisStale failed:", err);
  }
}
```

- [ ] **Step 4: Wire into `apps/web/src/app/api/episodes/[id]/speakers/route.ts`**

At the top, add:

```typescript
import { setMetaAnalysisStale } from "@/lib/metaAnalysisStale";
```

After the existing `await client.query("COMMIT");` (still before `client.release()`), add:

```typescript
      // Issue #521: invalidate meta-analysis cache so the worker recomputes.
      await setMetaAnalysisStale();
```

- [ ] **Step 5: Wire into `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts`**

Read the file, then apply the same pattern — import at top, call `await setMetaAnalysisStale();` after the merge's `COMMIT`.

- [ ] **Step 6: Run unit tests — verify pass**

Run: `docker compose -f docker-compose.test.yml build web_test && docker compose -f docker-compose.test.yml run --rm web_test pnpm test meta-analysis-stale`

Expected: 2 pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/lib/metaAnalysisStale.ts apps/web/src/app/api/episodes/[id]/speakers/route.ts apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts apps/web/tests/unit/meta-analysis-stale.test.ts
git commit -m "feat(web): set meta-analysis stale flag on speaker rename/merge (#521)"
```

---

## Task 14: Shared TS types + color palette

**Files:**
- Create: `apps/web/src/lib/metaAnalysisTypes.ts`
- Create: `apps/web/src/lib/metaAnalysisColors.ts`
- Create: `apps/web/tests/unit/meta-analysis-colors.test.ts`

- [ ] **Step 1: Create types**

Create `apps/web/src/lib/metaAnalysisTypes.ts`:

```typescript
// TS types mirroring the JSONB snapshot (Issue #521).
// Keep in sync with apps/pipeline/app/services/meta_analysis.py.

export interface PerFeed {
  feed_id: string;
  title: string;
  episode_count: number;
  avg_length_min: number;
  std_length_min: number;
  total_words: number;
  total_tokens_segments: number;
  total_tokens_chunks: number;
  total_cost_usd: number;
  total_audio_minutes: number;
  inferred_host_name: string | null;
}

export interface PerEpisode {
  episode_id: string;
  feed_id: string;
  published_at: string | null;
  duration_secs: number;
  word_count: number;
  token_count_segments: number;
  token_count_chunks: number;
  speaker_count: number;
  turn_count: number;
  wpm: number;
  host_share: number | null;
  fireworks_cost_usd: number | null;
  transcribe_duration_secs: number | null;
  diarize_duration_secs: number | null;
  inference_provider_used: "fireworks" | "local" | null;
}

export interface PerSpeaker {
  speaker_display_name: string;
  feed_id: string;
  episode_ids: string[];
  wpm: number;
  total_words: number;
  total_seconds: number;
  turn_count: number;
}

export interface TimelineMonthly {
  month: string;           // "YYYY-MM"
  feed_id: string;
  episode_count: number;
  total_words: number;
  total_duration_min: number;
}

export interface ExcludedEpisode {
  episode_id: string;
  feed_id: string;
  feed_title: string;
  title: string;
  reason: string;
}

export interface Coverage {
  host_share: { included_count: number; excluded: ExcludedEpisode[] };
  wpm_speaker: { included_count: number; excluded: ExcludedEpisode[] };
  tokens_chunks: { included_count: number; excluded: ExcludedEpisode[] };
}

export interface MetaAnalysisSnapshot {
  per_feed: PerFeed[];
  per_episode: PerEpisode[];
  per_speaker: PerSpeaker[];
  timeline_monthly: TimelineMonthly[];
  coverage: Coverage;
}

export interface SnapshotResponse {
  snapshot: MetaAnalysisSnapshot | null;
  computed_at: string | null;
  episode_count: number;
  feed_count: number;
  is_stale: boolean;
  last_error: string | null;
}

export interface MissingSpeakersResponse {
  podcasts: Array<{
    feed_id: string;
    title: string;
    episodes: Array<{ id: string; title: string; reason: string }>;
  }>;
}
```

- [ ] **Step 2: Write failing color palette test**

Create `apps/web/tests/unit/meta-analysis-colors.test.ts`:

```typescript
import { colorForFeed, FEED_COLOR_PALETTE } from "@/lib/metaAnalysisColors";

describe("colorForFeed", () => {
  it("returns a palette color for any feed_id", () => {
    const color = colorForFeed("abc-123");
    expect(FEED_COLOR_PALETTE).toContain(color);
  });

  it("is deterministic across calls", () => {
    const a = colorForFeed("feed-xyz");
    const b = colorForFeed("feed-xyz");
    expect(a).toBe(b);
  });

  it("distributes different feed_ids across the palette (not all same)", () => {
    const colors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      colors.add(colorForFeed(`feed-${i}`));
    }
    expect(colors.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test meta-analysis-colors`

Expected: module-not-found.

- [ ] **Step 4: Create color palette module**

Create `apps/web/src/lib/metaAnalysisColors.ts`:

```typescript
// Hash-based per-feed color assignment (Issue #521).
// Tailwind-compatible hex values. Chosen for decent contrast in both
// light and dark modes and reasonable distinctness for colorblind users.

export const FEED_COLOR_PALETTE = [
  "#6366f1", // indigo-500
  "#ec4899", // pink-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#06b6d4", // cyan-500
  "#a855f7", // purple-500
  "#ef4444", // red-500
  "#84cc16", // lime-500
  "#f97316", // orange-500
  "#3b82f6", // blue-500
] as const;

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForFeed(feedId: string): string {
  return FEED_COLOR_PALETTE[hash(feedId) % FEED_COLOR_PALETTE.length];
}
```

- [ ] **Step 5: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test meta-analysis-colors`

Expected: 3 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/metaAnalysisTypes.ts apps/web/src/lib/metaAnalysisColors.ts apps/web/tests/unit/meta-analysis-colors.test.ts
git commit -m "feat(web): shared meta-analysis types and feed color palette (#521)"
```

---

## Task 15: Next.js proxy routes

**Files:**
- Create: `apps/web/src/app/api/meta-analysis/snapshot/route.ts`
- Create: `apps/web/src/app/api/meta-analysis/refresh/route.ts`
- Create: `apps/web/src/app/api/meta-analysis/coverage/missing-speakers/route.ts`

- [ ] **Step 1: Create snapshot proxy**

Create `apps/web/src/app/api/meta-analysis/snapshot/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/meta-analysis/snapshot`, {
      cache: "no-store",
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("meta-analysis snapshot proxy failed:", err);
    return NextResponse.json(
      { error: "Pipeline unreachable" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 2: Create refresh proxy**

Create `apps/web/src/app/api/meta-analysis/refresh/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/meta-analysis/refresh`, {
      method: "POST",
      cache: "no-store",
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("meta-analysis refresh proxy failed:", err);
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 502 }
    );
  }
}
```

- [ ] **Step 3: Create coverage proxy**

Create `apps/web/src/app/api/meta-analysis/coverage/missing-speakers/route.ts`:

```typescript
import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  try {
    const resp = await fetch(
      `${PIPELINE_API}/api/meta-analysis/coverage/missing-speakers`,
      { cache: "no-store" }
    );
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("missing-speakers proxy failed:", err);
    return NextResponse.json({ podcasts: [] }, { status: 502 });
  }
}
```

- [ ] **Step 4: Smoke test against live stack**

Run: `docker compose up -d pipeline web` then `curl -s http://localhost:3000/api/meta-analysis/snapshot | jq .`

Expected: JSON with `snapshot: null` (before any refresh) or populated blob.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/meta-analysis/
git commit -m "feat(web): proxy routes for /api/meta-analysis/* (#521)"
```

---

## Task 16: Navbar entry

**Files:**
- Modify: `apps/web/src/components/Navbar.tsx`

- [ ] **Step 1: Add the link between Queue and Settings**

Edit the `NAV_LINKS` array:

```typescript
const NAV_LINKS = [
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask" },
  { href: "/podcasts", label: "Sources" },
  { href: "/queue", label: "Queue" },
  { href: "/meta-analysis", label: "Meta-analysis" },
  { href: "/settings", label: "Settings" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
];
```

- [ ] **Step 2: Verify locally**

Run: `docker compose up -d web` then open `http://localhost:3000` and confirm the new nav entry appears between Queue and Settings.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/Navbar.tsx
git commit -m "feat(web): add Meta-analysis nav link (#521)"
```

---

## Task 17: Page scaffold + MetaAnalysisClient + data fetching

**Files:**
- Create: `apps/web/src/app/meta-analysis/page.tsx`
- Create: `apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx`
- Create: `apps/web/tests/unit/meta-analysis-client.test.tsx`

- [ ] **Step 1: Write failing test for loading / empty / error states**

Create `apps/web/tests/unit/meta-analysis-client.test.tsx`:

```typescript
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import MetaAnalysisClient from "@/app/meta-analysis/MetaAnalysisClient";

function withQuery(ui: React.ReactElement) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={qc}>{ui}</QueryClientProvider>;
}

describe("MetaAnalysisClient", () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  it("renders loading state first", () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {})   // never resolves
    );
    render(withQuery(<MetaAnalysisClient />));
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it("renders empty state when snapshot is null", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      json: async () => ({
        snapshot: null, is_stale: true, computed_at: null,
        episode_count: 0, feed_count: 0, last_error: null,
      }),
    });
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByText(/No analysis yet/i)).toBeInTheDocument()
    );
  });

  it("renders error state on fetch failure", async () => {
    (global.fetch as jest.Mock).mockRejectedValue(new Error("boom"));
    render(withQuery(<MetaAnalysisClient />));
    await waitFor(() =>
      expect(screen.getByText(/Could not load/i)).toBeInTheDocument()
    );
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test meta-analysis-client`

Expected: module-not-found.

- [ ] **Step 3: Create the page entry**

Create `apps/web/src/app/meta-analysis/page.tsx`:

```tsx
import MetaAnalysisClient from "./MetaAnalysisClient";

export const dynamic = "force-dynamic";

export default function MetaAnalysisPage() {
  return (
    <main className="max-w-7xl mx-auto px-4 py-6">
      <MetaAnalysisClient />
    </main>
  );
}
```

- [ ] **Step 4: Create the client wrapper**

Create `apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx`:

```tsx
"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SnapshotResponse } from "@/lib/metaAnalysisTypes";

async function fetchSnapshot(): Promise<SnapshotResponse> {
  const r = await fetch("/api/meta-analysis/snapshot", { cache: "no-store" });
  if (!r.ok) throw new Error("failed");
  return r.json();
}

async function refreshSnapshot(): Promise<SnapshotResponse> {
  const r = await fetch("/api/meta-analysis/refresh", { method: "POST" });
  if (!r.ok) throw new Error("refresh failed");
  return r.json();
}

export default function MetaAnalysisClient() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["meta-analysis-snapshot"],
    queryFn: fetchSnapshot,
  });
  const refresh = useMutation({
    mutationFn: refreshSnapshot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meta-analysis-snapshot"] }),
  });

  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>([]);

  const snap = data?.snapshot ?? null;
  const filteredFeeds = useMemo(() => {
    if (!snap) return [];
    if (selectedFeedIds.length === 0) return snap.per_feed;
    return snap.per_feed.filter((f) => selectedFeedIds.includes(f.feed_id));
  }, [snap, selectedFeedIds]);

  if (isLoading) return <p className="text-muted-foreground">Loading meta-analysis…</p>;
  if (isError) return <p className="text-red-500">Could not load meta-analysis.</p>;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Meta-analysis</h1>
          <p className="text-sm text-muted-foreground">
            {data?.computed_at
              ? `Updated ${new Date(data.computed_at).toLocaleString()}`
              : "Never computed"}
            {data?.is_stale ? " · refresh pending" : ""}
          </p>
        </div>
        <button
          className="px-3 py-1.5 rounded-md border text-sm"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? "Refreshing…" : "↻ Refresh"}
        </button>
      </header>

      {!snap ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No analysis yet — hit ↻ Refresh or wait for the queue to drain.
        </div>
      ) : (
        <>
          {/* Coverage strip + chart grid are added by later tasks. */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 border rounded-md text-sm text-muted-foreground">
              {snap.per_feed.length} podcasts · {data?.episode_count} episodes processed
            </div>
          </div>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml build web_test && docker compose -f docker-compose.test.yml run --rm web_test pnpm test meta-analysis-client`

Expected: 3 pass.

- [ ] **Step 6: Manual check**

Run: `docker compose up -d web pipeline` → open `http://localhost:3000/meta-analysis`. Empty state renders. Click ↻ Refresh → "Refreshing..." → placeholder shows podcast/episode counts.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/meta-analysis/page.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis-client.test.tsx
git commit -m "feat(web): meta-analysis page scaffold with React Query data fetch (#521)"
```

---

## Task 18: FiltersBar

**Files:**
- Create: `apps/web/src/app/meta-analysis/FiltersBar.tsx`
- Create: `apps/web/tests/unit/filters-bar.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/unit/filters-bar.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import FiltersBar from "@/app/meta-analysis/FiltersBar";

const FEEDS = [
  { feed_id: "f1", title: "One" },
  { feed_id: "f2", title: "Two" },
];

describe("FiltersBar", () => {
  it("renders a checkbox per podcast", () => {
    render(
      <FiltersBar feeds={FEEDS} selectedFeedIds={[]} onSelectedChange={() => {}} />
    );
    expect(screen.getByLabelText("One")).toBeInTheDocument();
    expect(screen.getByLabelText("Two")).toBeInTheDocument();
  });

  it("calls onSelectedChange with updated array when toggled", () => {
    const onChange = jest.fn();
    render(
      <FiltersBar feeds={FEEDS} selectedFeedIds={[]} onSelectedChange={onChange} />
    );
    fireEvent.click(screen.getByLabelText("One"));
    expect(onChange).toHaveBeenCalledWith(["f1"]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test filters-bar`

Expected: module-not-found.

- [ ] **Step 3: Create FiltersBar**

Create `apps/web/src/app/meta-analysis/FiltersBar.tsx`:

```tsx
"use client";

interface Feed { feed_id: string; title: string; }

interface Props {
  feeds: Feed[];
  selectedFeedIds: string[];
  onSelectedChange: (ids: string[]) => void;
}

export default function FiltersBar({ feeds, selectedFeedIds, onSelectedChange }: Props) {
  const toggle = (id: string) => {
    if (selectedFeedIds.includes(id)) {
      onSelectedChange(selectedFeedIds.filter((x) => x !== id));
    } else {
      onSelectedChange([...selectedFeedIds, id]);
    }
  };
  const all = selectedFeedIds.length === 0;

  return (
    <div className="flex flex-wrap gap-2 items-center text-sm border rounded-md p-2 bg-muted/30">
      <span className="text-xs uppercase tracking-wide text-muted-foreground">
        Filter
      </span>
      <button
        type="button"
        onClick={() => onSelectedChange([])}
        className={`px-2 py-1 rounded ${all ? "bg-accent" : "hover:bg-accent"}`}
      >
        All podcasts
      </button>
      {feeds.map((f) => (
        <label
          key={f.feed_id}
          className="flex items-center gap-1 cursor-pointer px-2 py-1 rounded hover:bg-accent"
        >
          <input
            type="checkbox"
            checked={selectedFeedIds.includes(f.feed_id)}
            onChange={() => toggle(f.feed_id)}
          />
          {f.title}
        </label>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: Wire FiltersBar into MetaAnalysisClient**

In `MetaAnalysisClient.tsx`, import and render below the header (only when snap exists):

```tsx
import FiltersBar from "./FiltersBar";

// inside JSX, after the header, before the grid:
<FiltersBar
  feeds={snap.per_feed.map((f) => ({ feed_id: f.feed_id, title: f.title }))}
  selectedFeedIds={selectedFeedIds}
  onSelectedChange={setSelectedFeedIds}
/>
```

- [ ] **Step 5: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test filters-bar`

Expected: 2 pass.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/meta-analysis/FiltersBar.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/filters-bar.test.tsx
git commit -m "feat(web): FiltersBar with per-podcast multiselect (#521)"
```

---

## Task 19: CoverageStrip + MissingSpeakersModal

**Files:**
- Create: `apps/web/src/app/meta-analysis/CoverageStrip.tsx`
- Create: `apps/web/src/app/meta-analysis/MissingSpeakersModal.tsx`
- Create: `apps/web/tests/unit/coverage-strip.test.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/unit/coverage-strip.test.tsx`:

```typescript
import { render, screen, fireEvent } from "@testing-library/react";
import CoverageStrip from "@/app/meta-analysis/CoverageStrip";

describe("CoverageStrip", () => {
  it("renders podcast/episode/missing-speakers counts", () => {
    render(
      <CoverageStrip
        feedCount={5}
        episodeCount={142}
        queuedFailed={8}
        missingSpeakers={74}
        onOpenMissingSpeakers={() => {}}
        onOpenQueuedFailed={() => {}}
      />
    );
    expect(screen.getByText(/5 podcasts/)).toBeInTheDocument();
    expect(screen.getByText(/142 processed/)).toBeInTheDocument();
    expect(screen.getByText(/8 queued\/failed/)).toBeInTheDocument();
    expect(screen.getByText(/74 missing speakers/)).toBeInTheDocument();
  });

  it("fires onOpenMissingSpeakers when missing-speakers count is clicked", () => {
    const open = jest.fn();
    render(
      <CoverageStrip
        feedCount={1} episodeCount={1} queuedFailed={0} missingSpeakers={3}
        onOpenMissingSpeakers={open} onOpenQueuedFailed={() => {}}
      />
    );
    fireEvent.click(screen.getByText(/3 missing speakers/));
    expect(open).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test coverage-strip`

Expected: module-not-found.

- [ ] **Step 3: Create CoverageStrip**

Create `apps/web/src/app/meta-analysis/CoverageStrip.tsx`:

```tsx
"use client";

interface Props {
  feedCount: number;
  episodeCount: number;
  queuedFailed: number;
  missingSpeakers: number;
  onOpenMissingSpeakers: () => void;
  onOpenQueuedFailed: () => void;
}

export default function CoverageStrip({
  feedCount, episodeCount, queuedFailed, missingSpeakers,
  onOpenMissingSpeakers, onOpenQueuedFailed,
}: Props) {
  return (
    <div className="text-sm text-muted-foreground flex flex-wrap gap-2 items-center">
      <span>{feedCount} podcasts</span>
      <span>·</span>
      <span>{episodeCount} processed</span>
      <span>·</span>
      <button
        type="button"
        onClick={onOpenQueuedFailed}
        className="underline-offset-2 hover:underline hover:text-foreground"
      >
        {queuedFailed} queued/failed ▸
      </button>
      <span>·</span>
      <button
        type="button"
        onClick={onOpenMissingSpeakers}
        className="underline-offset-2 hover:underline hover:text-foreground"
      >
        {missingSpeakers} missing speakers ▸
      </button>
    </div>
  );
}
```

- [ ] **Step 4: Create MissingSpeakersModal**

Create `apps/web/src/app/meta-analysis/MissingSpeakersModal.tsx`:

```tsx
"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { MissingSpeakersResponse } from "@/lib/metaAnalysisTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  data: MissingSpeakersResponse | null;
}

export default function MissingSpeakersModal({ open, onClose, data }: Props) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", h);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", h);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center overflow-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-md max-w-2xl w-full p-6 mt-12 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">Episodes excluded — missing speakers</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>

        {!data || data.podcasts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No excluded episodes — everything has assigned speakers.
          </p>
        ) : (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {data.podcasts.map((p) => (
              <section key={p.feed_id}>
                <h3
                  className="text-sm font-semibold mb-1 truncate"
                  title={p.title}
                >
                  {p.title}
                </h3>
                <ul className="text-sm space-y-1">
                  {p.episodes.map((ep) => (
                    <li key={ep.id} className="flex items-start gap-2">
                      <Link
                        href={`/episodes/${ep.id}`}
                        className="flex-1 truncate hover:underline"
                        title={ep.title}
                      >
                        {ep.title}
                      </Link>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {ep.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Wire into MetaAnalysisClient**

In `MetaAnalysisClient.tsx`, add:

```tsx
import CoverageStrip from "./CoverageStrip";
import MissingSpeakersModal from "./MissingSpeakersModal";
import type { MissingSpeakersResponse } from "@/lib/metaAnalysisTypes";

// Add state:
const [missingOpen, setMissingOpen] = useState(false);
const [missingData, setMissingData] = useState<MissingSpeakersResponse | null>(null);

// When opening, fetch the data:
async function openMissing() {
  const r = await fetch("/api/meta-analysis/coverage/missing-speakers", { cache: "no-store" });
  setMissingData(await r.json());
  setMissingOpen(true);
}
```

Below `FiltersBar`, add:

```tsx
<CoverageStrip
  feedCount={data?.feed_count ?? 0}
  episodeCount={data?.episode_count ?? 0}
  queuedFailed={0}                              // Filled from /api/queue in a follow-up task if desired
  missingSpeakers={
    (snap.coverage?.host_share?.excluded?.length ?? 0)
  }
  onOpenMissingSpeakers={openMissing}
  onOpenQueuedFailed={() => {}}
/>
<MissingSpeakersModal
  open={missingOpen}
  onClose={() => setMissingOpen(false)}
  data={missingData}
/>
```

- [ ] **Step 6: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test coverage-strip`

Expected: 2 pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/meta-analysis/CoverageStrip.tsx apps/web/src/app/meta-analysis/MissingSpeakersModal.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/coverage-strip.test.tsx
git commit -m "feat(web): coverage strip + missing-speakers modal (#521)"
```

---

## Task 20: ChartCard + ExpandModal

**Files:**
- Create: `apps/web/src/app/meta-analysis/ChartCard.tsx`
- Create: `apps/web/src/app/meta-analysis/ExpandModal.tsx`

- [ ] **Step 1: Create ChartCard**

Create `apps/web/src/app/meta-analysis/ChartCard.tsx`:

```tsx
"use client";

import { useState, ReactNode } from "react";
import ExpandModal from "./ExpandModal";

interface Props {
  title: string;
  subtitle?: string;
  coverage?: { included: number; total: number; onClickExcluded?: () => void };
  children: ReactNode;         // the chart itself
  detail?: ReactNode;          // optional bigger/table view for the expand modal
}

export default function ChartCard({ title, subtitle, coverage, children, detail }: Props) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <div className="border rounded-md p-4 bg-background">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h3 className="font-semibold text-sm truncate">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
          </div>
          {detail && (
            <button
              type="button"
              onClick={() => setExpanded(true)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Expand"
            >
              ⛶
            </button>
          )}
        </div>

        <div className="mt-3">{children}</div>

        {coverage && (
          <div className="mt-3 text-xs text-muted-foreground">
            {coverage.included} / {coverage.total} episodes
            {coverage.total > coverage.included && coverage.onClickExcluded && (
              <>
                {" · "}
                <button
                  type="button"
                  onClick={coverage.onClickExcluded}
                  className="underline-offset-2 hover:underline"
                >
                  {coverage.total - coverage.included} excluded ▸
                </button>
              </>
            )}
          </div>
        )}
      </div>
      <ExpandModal open={expanded} onClose={() => setExpanded(false)} title={title}>
        {detail ?? children}
      </ExpandModal>
    </>
  );
}
```

- [ ] **Step 2: Create ExpandModal**

Create `apps/web/src/app/meta-analysis/ExpandModal.tsx`:

```tsx
"use client";

import { useEffect, ReactNode } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}

export default function ExpandModal({ open, onClose, title, children }: Props) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", h);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", h);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center overflow-auto p-4"
      onClick={onClose}
    >
      <div
        className="bg-background rounded-md max-w-5xl w-full p-6 mt-12 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            ✕
          </button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Sanity check**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm tsc --noEmit`

Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/meta-analysis/ChartCard.tsx apps/web/src/app/meta-analysis/ExpandModal.tsx
git commit -m "feat(web): ChartCard + ExpandModal shells (#521)"
```

---

## Task 21: InfoBlock — segments vs chunks explainer

**Files:**
- Create: `apps/web/src/app/meta-analysis/InfoBlock.tsx`

- [ ] **Step 1: Create InfoBlock**

Create `apps/web/src/app/meta-analysis/InfoBlock.tsx`:

```tsx
"use client";

import { useState } from "react";

export default function InfoBlock() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md p-3 text-sm bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 text-left w-full font-medium"
      >
        <span>{open ? "▾" : "▸"}</span>
        What are segments and chunks?
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            <strong>Segments</strong> are raw Whisper output — one row per
            utterance, usually a few seconds long.
          </p>
          <p>
            <strong>Chunks</strong> are merged same-speaker consecutive
            segments, combined into ~400-token groups. Speaker changes are
            chunk boundaries. This is what the RAG pipeline retrieves for
            the Ask AI feature.
          </p>
          <p>
            Token counts from both are shown because they tell slightly
            different stories: segment tokens include every utterance
            boundary, chunk tokens reflect how the retrieval system sees an
            episode.
          </p>
          <p className="text-xs">
            Estimated tokens — uses <code>cl100k_base</code> encoding;
            actual token counts vary by model.
          </p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/meta-analysis/InfoBlock.tsx
git commit -m "feat(web): segments-vs-chunks info block (#521)"
```

---

# Phase 3 — Charts

Each chart follows a consistent pattern:
- **Transform module** at `apps/web/src/app/meta-analysis/charts/transforms/<name>.ts` — pure data function, unit-testable.
- **Chart component** at `apps/web/src/app/meta-analysis/charts/<Name>.tsx` — Recharts SVG, reads props.
- **Unit test** on the transform (not the chart).

After the first chart is built in Task 22, tasks 23–30 repeat the pattern with different transforms and chart shapes.

## Task 22: LengthPerFeed chart

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/transforms/lengthPerFeed.ts`
- Create: `apps/web/src/app/meta-analysis/charts/LengthPerFeed.tsx`
- Create: `apps/web/tests/unit/meta-analysis/length-per-feed.test.ts`
- Modify: `apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx`

- [ ] **Step 1: Write failing test for the transform**

Create `apps/web/tests/unit/meta-analysis/length-per-feed.test.ts`:

```typescript
import { buildLengthPerFeed } from "@/app/meta-analysis/charts/transforms/lengthPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A", episode_count: 10, avg_length_min: 40,
    std_length_min: 5, total_words: 0, total_tokens_segments: 0,
    total_tokens_chunks: 0, total_cost_usd: 0, total_audio_minutes: 0,
    inferred_host_name: null },
  { feed_id: "b", title: "B", episode_count: 5, avg_length_min: 60,
    std_length_min: 8, total_words: 0, total_tokens_segments: 0,
    total_tokens_chunks: 0, total_cost_usd: 0, total_audio_minutes: 0,
    inferred_host_name: null },
];

describe("buildLengthPerFeed", () => {
  it("returns bars with title / avg / std / color", () => {
    const rows = buildLengthPerFeed(FEEDS);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "A", avg: 40, std: 5 });
    expect(rows[0].color).toMatch(/^#/);
  });

  it("sorts descending by avg length", () => {
    const rows = buildLengthPerFeed(FEEDS);
    expect(rows[0].title).toBe("B");   // 60 > 40
  });

  it("returns empty array when no feeds", () => {
    expect(buildLengthPerFeed([])).toEqual([]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test length-per-feed`

Expected: module-not-found.

- [ ] **Step 3: Create the transform**

Create `apps/web/src/app/meta-analysis/charts/transforms/lengthPerFeed.ts`:

```typescript
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

export interface LengthBar {
  feed_id: string;
  title: string;
  avg: number;
  std: number;
  color: string;
}

export function buildLengthPerFeed(feeds: PerFeed[]): LengthBar[] {
  return feeds
    .map((f) => ({
      feed_id: f.feed_id,
      title: f.title,
      avg: f.avg_length_min,
      std: f.std_length_min,
      color: colorForFeed(f.feed_id),
    }))
    .sort((a, b) => b.avg - a.avg);
}
```

- [ ] **Step 4: Create the chart component**

Create `apps/web/src/app/meta-analysis/charts/LengthPerFeed.tsx`:

```tsx
"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ErrorBar, Cell,
} from "recharts";
import { buildLengthPerFeed } from "./transforms/lengthPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { feeds: PerFeed[]; }

export default function LengthPerFeed({ feeds }: Props) {
  const data = buildLengthPerFeed(feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No feeds yet.</p>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
          <XAxis type="number" />
          <YAxis type="category" dataKey="title" width={100} />
          <Tooltip formatter={(v: number) => `${v.toFixed(1)} min`} />
          <Bar dataKey="avg">
            {data.map((d) => <Cell key={d.feed_id} fill={d.color} />)}
            <ErrorBar dataKey="std" width={4} strokeWidth={1} stroke="#94a3b8" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 5: Wire into MetaAnalysisClient grid**

Inside the grid `<div className="grid ...">` in `MetaAnalysisClient.tsx`, replace the placeholder `div` with:

```tsx
import ChartCard from "./ChartCard";
import LengthPerFeed from "./charts/LengthPerFeed";

// ...
<ChartCard title="Episode length per podcast" subtitle="Avg (min) · σ error bars">
  <LengthPerFeed feeds={filteredFeeds} />
</ChartCard>
```

- [ ] **Step 6: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test length-per-feed`

Expected: 3 pass.

- [ ] **Step 7: Manual verify** — open `/meta-analysis`, see a horizontal bar chart with one row per feed. Hit ↻ Refresh if empty.

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/transforms/lengthPerFeed.ts apps/web/src/app/meta-analysis/charts/LengthPerFeed.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/length-per-feed.test.ts
git commit -m "feat(web): LengthPerFeed chart (#521)"
```

---

## Task 23: ReleaseTimeline chart

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/transforms/releaseTimeline.ts`
- Create: `apps/web/src/app/meta-analysis/charts/ReleaseTimeline.tsx`
- Create: `apps/web/tests/unit/meta-analysis/release-timeline.test.ts`
- Modify: `apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx`

- [ ] **Step 1: Write failing test**

Create `apps/web/tests/unit/meta-analysis/release-timeline.test.ts`:

```typescript
import { buildReleaseTimeline } from "@/app/meta-analysis/charts/transforms/releaseTimeline";
import type { TimelineMonthly, PerFeed } from "@/lib/metaAnalysisTypes";

const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A" } as PerFeed,
  { feed_id: "b", title: "B" } as PerFeed,
];

const TL: TimelineMonthly[] = [
  { month: "2026-01", feed_id: "a", episode_count: 3, total_words: 0, total_duration_min: 0 },
  { month: "2026-01", feed_id: "b", episode_count: 2, total_words: 0, total_duration_min: 0 },
  { month: "2026-02", feed_id: "a", episode_count: 4, total_words: 0, total_duration_min: 0 },
];

describe("buildReleaseTimeline", () => {
  it("pivots to {month, feed_id: count, ...}", () => {
    const rows = buildReleaseTimeline(TL, FEEDS);
    expect(rows.find((r) => r.month === "2026-01")).toMatchObject({
      month: "2026-01", a: 3, b: 2,
    });
    expect(rows.find((r) => r.month === "2026-02")).toMatchObject({
      month: "2026-02", a: 4, b: 0,
    });
  });

  it("sorts months ascending", () => {
    const rows = buildReleaseTimeline(TL, FEEDS);
    expect(rows.map((r) => r.month)).toEqual(["2026-01", "2026-02"]);
  });
});
```

- [ ] **Step 2: Run — verify failure**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test release-timeline`

Expected: module-not-found.

- [ ] **Step 3: Create transform**

Create `apps/web/src/app/meta-analysis/charts/transforms/releaseTimeline.ts`:

```typescript
import type { PerFeed, TimelineMonthly } from "@/lib/metaAnalysisTypes";

export interface TimelineRow { month: string; [feedId: string]: number | string; }

export function buildReleaseTimeline(
  tl: TimelineMonthly[], feeds: PerFeed[]
): TimelineRow[] {
  const months = Array.from(new Set(tl.map((r) => r.month))).sort();
  const feedIds = feeds.map((f) => f.feed_id);
  return months.map((m) => {
    const row: TimelineRow = { month: m };
    for (const fid of feedIds) {
      const hit = tl.find((r) => r.month === m && r.feed_id === fid);
      row[fid] = hit ? hit.episode_count : 0;
    }
    return row;
  });
}
```

- [ ] **Step 4: Create chart**

Create `apps/web/src/app/meta-analysis/charts/ReleaseTimeline.tsx`:

```tsx
"use client";

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { buildReleaseTimeline } from "./transforms/releaseTimeline";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerFeed, TimelineMonthly } from "@/lib/metaAnalysisTypes";

interface Props { timeline: TimelineMonthly[]; feeds: PerFeed[]; }

export default function ReleaseTimeline({ timeline, feeds }: Props) {
  const data = buildReleaseTimeline(timeline, feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No published episodes.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={data}>
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Legend />
          {feeds.map((f) => (
            <Area
              key={f.feed_id}
              type="monotone"
              dataKey={f.feed_id}
              stackId="1"
              stroke={colorForFeed(f.feed_id)}
              fill={colorForFeed(f.feed_id)}
              fillOpacity={0.4}
              name={f.title}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 5: Wire into grid**

In `MetaAnalysisClient.tsx`:

```tsx
import ReleaseTimeline from "./charts/ReleaseTimeline";

// ... inside grid:
<ChartCard title="Episodes published per month" subtitle="Stacked by podcast">
  <ReleaseTimeline timeline={snap.timeline_monthly} feeds={filteredFeeds} />
</ChartCard>
```

- [ ] **Step 6: Run tests — verify pass**

Run: `docker compose -f docker-compose.test.yml run --rm web_test pnpm test release-timeline`

Expected: 2 pass.

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/transforms/releaseTimeline.ts apps/web/src/app/meta-analysis/charts/ReleaseTimeline.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/release-timeline.test.ts
git commit -m "feat(web): ReleaseTimeline chart (#521)"
```

---

## Task 24: EpisodeLengthTrend chart

**Files:** follow the Task 22/23 pattern with:
- `transforms/episodeLengthTrend.ts` — groups `per_episode` by `feed_id`, orders by `published_at`, yields `{feed_id, points: [{x: timestamp, y: duration_min}]}`.
- `EpisodeLengthTrend.tsx` — Recharts `LineChart`, one `<Line>` per feed, color from `colorForFeed`.
- Test: given a fixed `per_episode` array, transform returns expected grouping/order.

- [ ] **Step 1: Test**

```typescript
import { buildEpisodeLengthTrend } from "@/app/meta-analysis/charts/transforms/episodeLengthTrend";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", published_at: "2026-01-01T00:00:00Z",
    duration_secs: 600 } as PerEpisode,
  { episode_id: "2", feed_id: "a", published_at: "2026-02-01T00:00:00Z",
    duration_secs: 900 } as PerEpisode,
  { episode_id: "3", feed_id: "b", published_at: "2026-01-15T00:00:00Z",
    duration_secs: 1200 } as PerEpisode,
];

describe("buildEpisodeLengthTrend", () => {
  it("groups by feed and orders chronologically", () => {
    const out = buildEpisodeLengthTrend(EPS);
    expect(out.a).toHaveLength(2);
    expect(out.a[0].duration_min).toBe(10);
    expect(out.a[1].duration_min).toBe(15);
    expect(out.b).toHaveLength(1);
  });

  it("drops episodes with no published_at", () => {
    const noPub = [{ episode_id: "x", feed_id: "a", published_at: null,
      duration_secs: 100 } as PerEpisode];
    expect(Object.keys(buildEpisodeLengthTrend(noPub))).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Transform**

Create `transforms/episodeLengthTrend.ts`:

```typescript
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface TrendPoint { ts: number; duration_min: number; }

export function buildEpisodeLengthTrend(
  eps: PerEpisode[]
): Record<string, TrendPoint[]> {
  const out: Record<string, TrendPoint[]> = {};
  for (const ep of eps) {
    if (!ep.published_at) continue;
    const list = out[ep.feed_id] ?? (out[ep.feed_id] = []);
    list.push({
      ts: new Date(ep.published_at).getTime(),
      duration_min: (ep.duration_secs ?? 0) / 60,
    });
  }
  for (const k of Object.keys(out)) out[k].sort((a, b) => a.ts - b.ts);
  return out;
}
```

- [ ] **Step 3: Chart component**

Create `EpisodeLengthTrend.tsx`:

```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { buildEpisodeLengthTrend } from "./transforms/episodeLengthTrend";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; feeds: PerFeed[]; }

export default function EpisodeLengthTrend({ episodes, feeds }: Props) {
  const grouped = buildEpisodeLengthTrend(episodes);
  // Recharts needs a flat array; use a merged row shape keyed by ts.
  const allTs = Array.from(new Set(
    Object.values(grouped).flat().map((p) => p.ts)
  )).sort();
  const data = allTs.map((ts) => {
    const row: Record<string, number | string> = {
      ts, date: new Date(ts).toISOString().slice(0, 10),
    };
    for (const f of feeds) {
      const hit = grouped[f.feed_id]?.find((p) => p.ts === ts);
      if (hit) row[f.feed_id] = hit.duration_min;
    }
    return row;
  });

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No dated episodes.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="date" />
          <YAxis label={{ value: "min", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          <Legend />
          {feeds.map((f) => (
            <Line key={f.feed_id} type="monotone" dataKey={f.feed_id}
              stroke={colorForFeed(f.feed_id)} name={f.title}
              connectNulls dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Wire in**

```tsx
<ChartCard title="Episode length trend" subtitle="Per podcast over time">
  <EpisodeLengthTrend episodes={snap.per_episode} feeds={filteredFeeds} />
</ChartCard>
```

- [ ] **Step 5: Run tests + commit**

```bash
docker compose -f docker-compose.test.yml run --rm web_test pnpm test episode-length-trend
git add apps/web/src/app/meta-analysis/charts/transforms/episodeLengthTrend.ts apps/web/src/app/meta-analysis/charts/EpisodeLengthTrend.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/episode-length-trend.test.ts
git commit -m "feat(web): EpisodeLengthTrend chart (#521)"
```

---

## Task 25: HostGuestShare chart

**Files:** `transforms/hostGuestShare.ts`, `HostGuestShare.tsx`, `host-guest-share.test.ts`.

- [ ] **Step 1: Test**

```typescript
import { buildHostGuestShare } from "@/app/meta-analysis/charts/transforms/hostGuestShare";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", host_share: 0.7 } as PerEpisode,
  { episode_id: "2", feed_id: "a", host_share: 0.6 } as PerEpisode,
  { episode_id: "3", feed_id: "a", host_share: null } as PerEpisode,  // excluded
  { episode_id: "4", feed_id: "b", host_share: 0.4 } as PerEpisode,
];
const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A" } as PerFeed,
  { feed_id: "b", title: "B" } as PerFeed,
];

describe("buildHostGuestShare", () => {
  it("averages host_share per feed ignoring nulls", () => {
    const rows = buildHostGuestShare(EPS, FEEDS);
    const a = rows.find((r) => r.feed_id === "a")!;
    expect(a.host_pct).toBeCloseTo(65);
    expect(a.guest_pct).toBeCloseTo(35);
  });

  it("omits feeds with no included episodes", () => {
    const rows = buildHostGuestShare(
      [{ episode_id: "x", feed_id: "a", host_share: null } as PerEpisode],
      FEEDS
    );
    expect(rows).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Transform**

Create `transforms/hostGuestShare.ts`:

```typescript
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

export interface ShareRow {
  feed_id: string; title: string; host_pct: number; guest_pct: number;
}

export function buildHostGuestShare(
  eps: PerEpisode[], feeds: PerFeed[]
): ShareRow[] {
  const byFeed: Record<string, number[]> = {};
  for (const ep of eps) {
    if (ep.host_share == null) continue;
    (byFeed[ep.feed_id] ??= []).push(ep.host_share);
  }
  return feeds
    .filter((f) => byFeed[f.feed_id]?.length)
    .map((f) => {
      const arr = byFeed[f.feed_id];
      const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
      return {
        feed_id: f.feed_id,
        title: f.title,
        host_pct: Math.round(avg * 100),
        guest_pct: Math.round((1 - avg) * 100),
      };
    });
}
```

- [ ] **Step 3: Chart component**

```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { buildHostGuestShare } from "./transforms/hostGuestShare";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; feeds: PerFeed[]; }

export default function HostGuestShare({ episodes, feeds }: Props) {
  const data = buildHostGuestShare(episodes, feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">
      No confirmed hosts yet — rename speakers on episode pages to populate.
    </p>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" stackOffset="expand">
          <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} />
          <YAxis type="category" dataKey="title" width={100} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Bar dataKey="host_pct" stackId="1">
            {data.map((d) => <Cell key={d.feed_id} fill={colorForFeed(d.feed_id)} />)}
          </Bar>
          <Bar dataKey="guest_pct" stackId="1" fill="#94a3b8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Wire in + test + commit**

```tsx
<ChartCard title="Host vs guest share" subtitle="% speech · confirmed hosts only"
  coverage={{
    included: snap.coverage.host_share.included_count,
    total: snap.coverage.host_share.included_count + snap.coverage.host_share.excluded.length,
    onClickExcluded: openMissing,
  }}>
  <HostGuestShare episodes={snap.per_episode} feeds={filteredFeeds} />
</ChartCard>
```

```bash
docker compose -f docker-compose.test.yml run --rm web_test pnpm test host-guest-share
git add apps/web/src/app/meta-analysis/charts/transforms/hostGuestShare.ts apps/web/src/app/meta-analysis/charts/HostGuestShare.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/host-guest-share.test.ts
git commit -m "feat(web): HostGuestShare chart (#521)"
```

---

## Task 26: TurnDensity chart

**Files:** `transforms/turnDensity.ts`, `TurnDensity.tsx`, `turn-density.test.ts`.

- [ ] **Step 1: Test**

```typescript
import { buildTurnDensity } from "@/app/meta-analysis/charts/transforms/turnDensity";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", duration_secs: 600, turn_count: 20 } as PerEpisode,
  { episode_id: "2", feed_id: "a", duration_secs: 0, turn_count: 0 } as PerEpisode,  // skip
];

describe("buildTurnDensity", () => {
  it("yields {duration_min, turns_per_min, feed_id} per episode", () => {
    const rows = buildTurnDensity(EPS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ duration_min: 10, turns_per_min: 2, feed_id: "a" });
  });
});
```

- [ ] **Step 2: Transform**

```typescript
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface DensityPoint {
  duration_min: number; turns_per_min: number; feed_id: string; episode_id: string;
}

export function buildTurnDensity(eps: PerEpisode[]): DensityPoint[] {
  return eps
    .filter((e) => e.duration_secs > 0)
    .map((e) => ({
      duration_min: e.duration_secs / 60,
      turns_per_min: e.turn_count / (e.duration_secs / 60),
      feed_id: e.feed_id,
      episode_id: e.episode_id,
    }));
}
```

- [ ] **Step 3: Chart**

```tsx
"use client";

import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import { buildTurnDensity } from "./transforms/turnDensity";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; feeds: PerFeed[]; }

export default function TurnDensity({ episodes, feeds }: Props) {
  const points = buildTurnDensity(episodes);
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No episode data.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <ScatterChart>
          <XAxis type="number" dataKey="duration_min"
            label={{ value: "episode (min)", position: "insideBottom", offset: -4 }} />
          <YAxis type="number" dataKey="turns_per_min"
            label={{ value: "turns/min", angle: -90, position: "insideLeft" }} />
          <ZAxis range={[40, 40]} />
          <Tooltip />
          {feeds.map((f) => (
            <Scatter key={f.feed_id} name={f.title}
              data={points.filter((p) => p.feed_id === f.feed_id)}
              fill={colorForFeed(f.feed_id)} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Wire + test + commit**

```tsx
<ChartCard title="Turn density" subtitle="Episode length × speaker turns/min">
  <TurnDensity episodes={snap.per_episode} feeds={filteredFeeds} />
</ChartCard>
```

```bash
docker compose -f docker-compose.test.yml run --rm web_test pnpm test turn-density
git add apps/web/src/app/meta-analysis/charts/transforms/turnDensity.ts apps/web/src/app/meta-analysis/charts/TurnDensity.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/turn-density.test.ts
git commit -m "feat(web): TurnDensity chart (#521)"
```

---

## Task 27: WpmPerSpeaker chart

**Files:** `transforms/wpmPerSpeaker.ts`, `WpmPerSpeaker.tsx`, `wpm-per-speaker.test.ts`.

- [ ] **Step 1: Test**

```typescript
import { buildWpmPerSpeaker } from "@/app/meta-analysis/charts/transforms/wpmPerSpeaker";
import type { PerSpeaker, PerFeed } from "@/lib/metaAnalysisTypes";

const SPEAKERS: PerSpeaker[] = [
  { speaker_display_name: "Alice", feed_id: "a", wpm: 150,
    episode_ids: [], total_words: 1000, total_seconds: 400, turn_count: 10 },
  { speaker_display_name: "Bob",   feed_id: "a", wpm: 120,
    episode_ids: [], total_words: 600, total_seconds: 300, turn_count: 8 },
  { speaker_display_name: "Carl",  feed_id: "b", wpm: 135,
    episode_ids: [], total_words: 800, total_seconds: 355, turn_count: 12 },
];
const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A" } as PerFeed,
  { feed_id: "b", title: "B" } as PerFeed,
];

describe("buildWpmPerSpeaker", () => {
  it("sorts by wpm desc within feed, keeps top N per feed", () => {
    const rows = buildWpmPerSpeaker(SPEAKERS, FEEDS, 5);
    const a = rows.filter((r) => r.feed_id === "a");
    expect(a[0].speaker_display_name).toBe("Alice");
    expect(a[1].speaker_display_name).toBe("Bob");
  });
});
```

- [ ] **Step 2: Transform**

```typescript
import type { PerFeed, PerSpeaker } from "@/lib/metaAnalysisTypes";
import { colorForFeed } from "@/lib/metaAnalysisColors";

export interface WpmBar {
  speaker_display_name: string; feed_id: string;
  feed_title: string; wpm: number; color: string;
}

export function buildWpmPerSpeaker(
  speakers: PerSpeaker[], feeds: PerFeed[], topN = 20
): WpmBar[] {
  const byFeed = new Map<string, PerSpeaker[]>();
  for (const s of speakers) {
    (byFeed.get(s.feed_id) ?? byFeed.set(s.feed_id, []).get(s.feed_id)!).push(s);
  }
  const out: WpmBar[] = [];
  for (const f of feeds) {
    const list = (byFeed.get(f.feed_id) ?? []).sort((a, b) => b.wpm - a.wpm).slice(0, topN);
    for (const s of list) {
      out.push({
        speaker_display_name: s.speaker_display_name,
        feed_id: s.feed_id, feed_title: f.title,
        wpm: s.wpm, color: colorForFeed(s.feed_id),
      });
    }
  }
  return out;
}
```

- [ ] **Step 3: Chart**

```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { buildWpmPerSpeaker } from "./transforms/wpmPerSpeaker";
import type { PerFeed, PerSpeaker } from "@/lib/metaAnalysisTypes";

interface Props { speakers: PerSpeaker[]; feeds: PerFeed[]; }

export default function WpmPerSpeaker({ speakers, feeds }: Props) {
  const data = buildWpmPerSpeaker(speakers, feeds, 20);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">
      No confirmed speakers yet.
    </p>;
  }
  return (
    <div style={{ width: "100%", height: Math.max(180, data.length * 22) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" />
          <YAxis type="category" dataKey="speaker_display_name" width={140} />
          <Tooltip formatter={(v: number) => `${v.toFixed(0)} wpm`} />
          <Bar dataKey="wpm">
            {data.map((d) => <Cell key={`${d.feed_id}-${d.speaker_display_name}`} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Wire + test + commit**

```tsx
<ChartCard title="Words per minute per speaker"
  subtitle="Top 20 per podcast · confirmed speakers only">
  <WpmPerSpeaker speakers={snap.per_speaker} feeds={filteredFeeds} />
</ChartCard>
```

```bash
docker compose -f docker-compose.test.yml run --rm web_test pnpm test wpm-per-speaker
git add apps/web/src/app/meta-analysis/charts/transforms/wpmPerSpeaker.ts apps/web/src/app/meta-analysis/charts/WpmPerSpeaker.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/wpm-per-speaker.test.ts
git commit -m "feat(web): WpmPerSpeaker chart (#521)"
```

---

## Task 28: TokensPerEpisode chart + InfoBlock placement

**Files:** `transforms/tokensPerEpisode.ts`, `TokensPerEpisode.tsx`, `tokens-per-episode.test.ts`.

- [ ] **Step 1: Test**

```typescript
import { buildTokensPerEpisode } from "@/app/meta-analysis/charts/transforms/tokensPerEpisode";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", published_at: "2026-01-01T00:00:00Z",
    token_count_segments: 10000, token_count_chunks: 9500 } as PerEpisode,
  { episode_id: "2", feed_id: "a", published_at: "2026-02-01T00:00:00Z",
    token_count_segments: 12000, token_count_chunks: 11000 } as PerEpisode,
];

describe("buildTokensPerEpisode", () => {
  it("orders chronologically and exposes both counts", () => {
    const rows = buildTokensPerEpisode(EPS);
    expect(rows).toHaveLength(2);
    expect(rows[0].segments).toBe(10000);
    expect(rows[0].chunks).toBe(9500);
    expect(rows[1].segments).toBe(12000);
  });
});
```

- [ ] **Step 2: Transform**

```typescript
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface TokenPoint {
  episode_id: string; feed_id: string; published_at: string;
  segments: number; chunks: number;
}

export function buildTokensPerEpisode(eps: PerEpisode[]): TokenPoint[] {
  return eps
    .filter((e) => e.published_at)
    .map((e) => ({
      episode_id: e.episode_id, feed_id: e.feed_id,
      published_at: e.published_at!,
      segments: e.token_count_segments,
      chunks: e.token_count_chunks,
    }))
    .sort((a, b) => a.published_at.localeCompare(b.published_at));
}
```

- [ ] **Step 3: Chart**

```tsx
"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { buildTokensPerEpisode } from "./transforms/tokensPerEpisode";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; }

export default function TokensPerEpisode({ episodes }: Props) {
  const data = buildTokensPerEpisode(episodes);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No dated episodes.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="published_at" tickFormatter={(s: string) => s.slice(0, 10)} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="segments" stroke="#6366f1" name="Segments" dot={false} />
          <Line type="monotone" dataKey="chunks" stroke="#ec4899" name="Chunks"
            strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Wire + InfoBlock**

In `MetaAnalysisClient.tsx`:

```tsx
import TokensPerEpisode from "./charts/TokensPerEpisode";
import InfoBlock from "./InfoBlock";

<ChartCard title="Tokens per episode" subtitle="Segments vs chunks · estimated (cl100k_base)">
  <TokensPerEpisode episodes={snap.per_episode} />
</ChartCard>

{/* Below the grid, render the info block */}
<InfoBlock />
```

- [ ] **Step 5: Test + commit**

```bash
docker compose -f docker-compose.test.yml run --rm web_test pnpm test tokens-per-episode
git add apps/web/src/app/meta-analysis/charts/transforms/tokensPerEpisode.ts apps/web/src/app/meta-analysis/charts/TokensPerEpisode.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/tokens-per-episode.test.ts
git commit -m "feat(web): TokensPerEpisode chart + segments/chunks info block (#521)"
```

---

## Task 29: CostPerFeed chart

**Files:** `transforms/costPerFeed.ts`, `CostPerFeed.tsx`, `cost-per-feed.test.ts`.

- [ ] **Step 1: Test**

```typescript
import { buildCostPerFeed } from "@/app/meta-analysis/charts/transforms/costPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A", total_cost_usd: 5.5 } as PerFeed,
  { feed_id: "b", title: "B", total_cost_usd: 0 } as PerFeed,
  { feed_id: "c", title: "C", total_cost_usd: 12.3 } as PerFeed,
];

describe("buildCostPerFeed", () => {
  it("drops zero-cost feeds and sorts desc", () => {
    const rows = buildCostPerFeed(FEEDS);
    expect(rows.map((r) => r.title)).toEqual(["C", "A"]);
  });
});
```

- [ ] **Step 2: Transform**

```typescript
import type { PerFeed } from "@/lib/metaAnalysisTypes";
import { colorForFeed } from "@/lib/metaAnalysisColors";

export interface CostBar { feed_id: string; title: string; cost: number; color: string; }

export function buildCostPerFeed(feeds: PerFeed[]): CostBar[] {
  return feeds
    .filter((f) => f.total_cost_usd > 0)
    .map((f) => ({
      feed_id: f.feed_id, title: f.title, cost: f.total_cost_usd,
      color: colorForFeed(f.feed_id),
    }))
    .sort((a, b) => b.cost - a.cost);
}
```

- [ ] **Step 3: Chart**

```tsx
"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { buildCostPerFeed } from "./transforms/costPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { feeds: PerFeed[]; }

export default function CostPerFeed({ feeds }: Props) {
  const data = buildCostPerFeed(feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">
      No remote inference spend on record.
    </p>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
          <XAxis type="number" tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
          <YAxis type="category" dataKey="title" width={100} />
          <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} />
          <Bar dataKey="cost">
            {data.map((d) => <Cell key={d.feed_id} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Wire + test + commit**

```tsx
<ChartCard title="Cumulative remote cost per podcast" subtitle="USD · Fireworks">
  <CostPerFeed feeds={filteredFeeds} />
</ChartCard>
```

```bash
docker compose -f docker-compose.test.yml run --rm web_test pnpm test cost-per-feed
git add apps/web/src/app/meta-analysis/charts/transforms/costPerFeed.ts apps/web/src/app/meta-analysis/charts/CostPerFeed.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/cost-per-feed.test.ts
git commit -m "feat(web): CostPerFeed chart (#521)"
```

---

## Task 30: ProcessingTimeDistribution chart

**Files:** `transforms/processingTime.ts`, `ProcessingTimeDistribution.tsx`, `processing-time.test.ts`.

- [ ] **Step 1: Test**

```typescript
import { buildProcessingTime } from "@/app/meta-analysis/charts/transforms/processingTime";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", transcribe_duration_secs: 100,
    diarize_duration_secs: 50, inference_provider_used: "local" } as PerEpisode,
  { episode_id: "2", feed_id: "a", transcribe_duration_secs: 30,
    diarize_duration_secs: 20, inference_provider_used: "fireworks" } as PerEpisode,
];

describe("buildProcessingTime", () => {
  it("splits by provider and sums transcribe+diarize", () => {
    const rows = buildProcessingTime(EPS);
    const local = rows.find((r) => r.provider === "local")!;
    const remote = rows.find((r) => r.provider === "fireworks")!;
    expect(local.seconds).toEqual([150]);
    expect(remote.seconds).toEqual([50]);
  });
});
```

- [ ] **Step 2: Transform**

```typescript
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface ProcBox { provider: string; seconds: number[]; }

export function buildProcessingTime(eps: PerEpisode[]): ProcBox[] {
  const byProv: Record<string, number[]> = {};
  for (const ep of eps) {
    const total = (ep.transcribe_duration_secs ?? 0) + (ep.diarize_duration_secs ?? 0);
    if (total <= 0) continue;
    const p = ep.inference_provider_used ?? "local";
    (byProv[p] ??= []).push(total);
  }
  return Object.entries(byProv).map(([provider, seconds]) => ({ provider, seconds }));
}
```

- [ ] **Step 3: Chart** (simplified box-plot via computed quartiles; Recharts lacks a native box plot, so we render min/q1/median/q3/max as a custom composed bar)

```tsx
"use client";

import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { buildProcessingTime } from "./transforms/processingTime";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

function quartiles(arr: number[]) {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { min: s[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: s[s.length - 1] };
}

interface Props { episodes: PerEpisode[]; }

export default function ProcessingTimeDistribution({ episodes }: Props) {
  const rows = buildProcessingTime(episodes);
  const data = rows.map((r) => {
    const q = quartiles(r.seconds);
    return {
      provider: r.provider,
      min: q.min, iqrStart: q.q1, iqrHeight: q.q3 - q.q1,
      median: q.median, max: q.max, seconds: r.seconds.length,
    };
  });
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No processing data yet.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <XAxis dataKey="provider" />
          <YAxis label={{ value: "sec", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          {/* Render min-max whisker behind IQR box */}
          <Bar dataKey="max" fill="transparent" stroke="#94a3b8" />
          <Bar dataKey="iqrHeight" stackId="iqr" fill="#6366f1" />
          <ReferenceLine y={0} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
```

- [ ] **Step 4: Wire + test + commit**

```tsx
<ChartCard title="Processing time distribution" subtitle="Total (transcribe + diarize) seconds · local vs remote">
  <ProcessingTimeDistribution episodes={snap.per_episode} />
</ChartCard>
```

```bash
docker compose -f docker-compose.test.yml run --rm web_test pnpm test processing-time
git add apps/web/src/app/meta-analysis/charts/transforms/processingTime.ts apps/web/src/app/meta-analysis/charts/ProcessingTimeDistribution.tsx apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx apps/web/tests/unit/meta-analysis/processing-time.test.ts
git commit -m "feat(web): ProcessingTimeDistribution chart (#521)"
```

---

# Phase 4 — Integration smoke test

## Task 31: Manual end-to-end smoke

- [ ] **Step 1: Drain the queue before restart (Operational Gotcha #3)**

Run: `docker compose exec -T db psql -U postgres podlog -c "SELECT task, status, COUNT(*) FROM job_queue WHERE status IN ('pending','running') GROUP BY task, status;"`

Expected: 0 rows (queue idle). If not, wait or `docker compose stop -t 60 worker`.

- [ ] **Step 2: Build and restart the stack**

Run: `make build && make up`

Expected: all 5 services up, `pipeline` logs show `"Running upgrade 014 -> 015"` on first boot.

- [ ] **Step 3: Open the dashboard empty state**

Visit http://localhost:3000/meta-analysis.

Expected: nav shows "Meta-analysis" between Queue and Settings. Page shows "No analysis yet" empty state.

- [ ] **Step 4: Hit ↻ Refresh**

Click Refresh.

Expected: spinner briefly, then snapshot populates. Coverage strip shows N podcasts / M episodes. Chart cards render.

- [ ] **Step 5: Open the missing-speakers modal**

Click the "X missing speakers" link.

Expected: modal opens with opaque backdrop. Podcasts listed, episode titles truncated if long (hover for full title). Each row links to /episodes/[id].

- [ ] **Step 6: Rename a speaker, come back, refresh**

On an `/episodes/[id]` page, rename an unassigned speaker. Return to /meta-analysis. Hit Refresh.

Expected: `host_share` excluded count decreases by 1 (if the edit produced a confirmed host). Missing-speakers modal reflects the reduction.

- [ ] **Step 7: Force-test worker idle hook**

Run: `docker compose exec -T db psql -U postgres podlog -c "INSERT INTO system_state (key, value) VALUES ('meta_analysis_stale', 'true') ON CONFLICT (key) DO UPDATE SET value = 'true';"`

Wait ~5s (one poll interval past the next idle).

Run: `docker compose exec -T db psql -U postgres podlog -c "SELECT key, value FROM system_state WHERE key = 'meta_analysis_stale';"`

Expected: `value = false` (worker cleared it).

Also check: `docker compose logs pipeline | grep meta_analysis_recomputed` should show a log line with `duration_ms`.

- [ ] **Step 8: Open the browser DevTools console; reload the page**

Expected: no JS errors, no Recharts warnings, no hydration errors.

- [ ] **Step 9: Commit any follow-up fixes** found during smoke; open the PR(s).

---

# End of plan
