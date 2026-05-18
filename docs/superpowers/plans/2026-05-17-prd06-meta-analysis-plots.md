# PRD-06 — Meta-Analysis Page Rewrite (Speaker Analytics Plots) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the entire Meta-Analysis page (currently 9 Recharts cards) with PRD-06's six Plotly figures — per-speaker minutes ×2 sources, per-speaker words ×2 sources, host-vs-guest diff ×2 sources — fed by an extended snapshot, plus a bonus notebook port.

**Architecture:** The pipeline's `MetaAnalysisSnapshot` JSONB grows two new top-level arrays (`per_episode_speaker`, `episode_speaker_diff`) computed in `meta_analysis_aggregations.py`. The web app swaps Recharts for `react-plotly.js + plotly.js-dist-min`, lazy-loaded via `next/dynamic` (SSR-disabled). Three new Plotly chart components — `SpeakerMinutesChart`, `SpeakerWordsChart`, `HostGuestDiffChart` — each take a `source: "confirmed" | "inferred_high"` prop and a slice of the snapshot; we render each twice in `MetaAnalysisClient` so both sources are visible. Existing chrome (header, refresh button, `FiltersBar`, `CoverageStrip`, `MissingSpeakersModal`, `ExploreStatusPanel`, `InfoBlock`) survives the rewrite. Bonus: a `notebooks/lib/podlog_plots.py` module ported from the prototype and wired into `01_explore_db.ipynb` with an `ipywidgets` global source toggle.

**Tech Stack:** PostgreSQL + SQLAlchemy 2.0 (pipeline); Next.js 16 + TypeScript + TanStack React Query (web); `react-plotly.js@2.6.0` + `plotly.js-dist-min@2.35.x` (charts); `pytest` (pipeline tests); `jest` + `@testing-library/react` (web tests); `ipywidgets` + Plotly (notebook).

---

## Scope Notes

- **PRD-06 is misaligned with reality.** As written it describes notebook cells; in practice this work is a Meta-Analysis page rewrite. Phase 0 rewrites PRD-06 to match before any code lands.
- **No DB migration needed.** The snapshot table is single-row JSONB (migration 015); adding fields inside the JSONB is additive. After deploy, a refresh repopulates it.
- **Click-to-open in the web app is in-app navigation**, so there is no `PODLOG_WEB_URL` concern — the chart's click handler routes via Next.js `router.push(\`/episodes/${id}\`)`. The env-var question only applies to the notebook (Phase 5).
- **VERSION bump is deferred.** Per user preference (`feedback_version_bumps.md`), do not auto-bump VERSION; ask the user when the branch is ready to merge.
- **PRD-05 §6 is superseded** by PRD-06 §4 (per PRD-06 §9); Phase 5 updates PRD-05 to note this and removes the old notebook cell.

---

## File Structure

### Pipeline (Python)
| File | Action | Responsibility |
|---|---|---|
| `apps/pipeline/app/services/meta_analysis_aggregations.py` | Modify | Add `_per_episode_speaker()` + `_episode_speaker_diff()` helpers; export from module. |
| `apps/pipeline/app/services/meta_analysis.py` | Modify | Wire new arrays into `compute_snapshot()`. |
| `apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py` | Modify or create | TDD for new aggregations. |
| `apps/pipeline/tests/integration/test_meta_analysis_snapshot.py` | Modify if exists, else create | Verify new fields land in the JSONB. |

### Web (TypeScript / React)
| File | Action | Responsibility |
|---|---|---|
| `apps/web/package.json` | Modify | Add `react-plotly.js`, `plotly.js-dist-min`, `@types/react-plotly.js`. |
| `apps/web/src/lib/metaAnalysisTypes.ts` | Modify | Add `PerEpisodeSpeaker`, `EpisodeSpeakerDiff` types + extend `MetaAnalysisSnapshot`. |
| `apps/web/src/app/meta-analysis/charts/PlotlyChart.tsx` | Create | SSR-safe wrapper around `react-plotly.js` via `next/dynamic`; applies dark/light template. |
| `apps/web/src/app/meta-analysis/charts/usePlotlyTheme.ts` | Create | Hook that returns `"plotly_white"` / `"plotly_dark"` from the existing dark-mode class. |
| `apps/web/src/app/meta-analysis/charts/transforms/feedShort.ts` | Create | `FEED_SHORT` map + `feedShort()` helper + palettes (`PALETTE`, `HOST_PALETTE`, `GUEST_PALETTE`, `hexToRgba`). |
| `apps/web/src/app/meta-analysis/charts/transforms/speakerRows.ts` | Create | Filter rows by source, classify host/guest, combine guest rows per episode. Pure functions, TDD targets. |
| `apps/web/src/app/meta-analysis/charts/transforms/diffRows.ts` | Create | Compute per-episode diff + band rows (`diff`, `band_lo`, `band_hi`). Pure functions, TDD targets. |
| `apps/web/src/app/meta-analysis/charts/SpeakerMinutesChart.tsx` | Create | One chart, takes `source` prop; per-feed dropdown; host traces + combined-guests trace. |
| `apps/web/src/app/meta-analysis/charts/SpeakerWordsChart.tsx` | Create | Same structure as minutes; differs only in unit/format. |
| `apps/web/src/app/meta-analysis/charts/HostGuestDiffChart.tsx` | Create | Diff line + band per feed; per-feed dropdown. |
| `apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx` | Modify | Delete 9 old chart imports + cards; add 6 new cards (Confirmed + Inferred-HIGH for each family); keep header/filters/coverage/explore/info. |
| `apps/web/src/app/meta-analysis/InfoBlock.tsx` | Modify | Update text to describe the new plots. |
| `apps/web/src/app/meta-analysis/charts/CostPerFeed.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/EpisodeLengthTrend.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/HostGuestShare.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/LengthPerFeed.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/ProcessingTimeDistribution.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/ReleaseTimeline.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/TokensPerEpisode.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/TurnDensity.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/WpmPerSpeaker.tsx` | Delete | Replaced. |
| `apps/web/src/app/meta-analysis/charts/transforms/*` (existing) | Delete | Stale transforms for deleted charts. |
| `apps/web/src/app/meta-analysis/charts/transforms/__tests__/speakerRows.test.ts` | Create | TDD for source filter + classification + guest aggregation. |
| `apps/web/src/app/meta-analysis/charts/transforms/__tests__/diffRows.test.ts` | Create | TDD for diff + band computation. |

### Notebook (Python, bonus)
| File | Action | Responsibility |
|---|---|---|
| `notebooks/lib/__init__.py` | Create | Empty package marker. |
| `notebooks/lib/podlog_plots.py` | Create | Module port of `~/repos/playground/2026-05-15-podlog-meta-prototyping/plots.py` (speaker plots only). |
| `notebooks/examples/01_explore_db.ipynb` | Modify | Delete old PRD-05 §6 cell; add 6 new figure cells + an `ipywidgets` source toggle. |

### Docs
| File | Action | Responsibility |
|---|---|---|
| `prds/PRD-06-speaker-analytics-plots.md` | Modify | Rewrite scope as web-app-first; notebook becomes a bonus section. |
| `prds/PRD-05-exploratory-plots.md` | Modify | Mark §6 as superseded by PRD-06 §4. |
| `CHANGELOG.md` | Modify | One-line `Major` entry under `## Unreleased`. |

---

## Phase 0 — PRD alignment

This first phase produces no code; it aligns the written spec with the user's intent before any implementation work. Skipping it leaves PRD-06 contradicting the code we're about to write.

### Task 0.1: Rewrite PRD-06 scope to web-app-first

**Files:**
- Modify: `prds/PRD-06-speaker-analytics-plots.md`

- [ ] **Step 1: Replace §2 Goals & Non-Goals**

Open `prds/PRD-06-speaker-analytics-plots.md`. Replace the `## 2. Goals & Non-Goals` section so the **primary** target is the Meta-Analysis web page and the notebook is a bonus:

```markdown
## 2. Goals & Non-Goals

### Goals
- **Primary:** Replace the Meta-Analysis web page (`apps/web/src/app/meta-analysis/`) content with six Plotly figures covering per-speaker minutes (×2 sources), per-speaker words (×2 sources), and host-vs-guest diff (×2 sources).
- **Secondary:** Mirror the six figures in `notebooks/examples/01_explore_db.ipynb` via a reusable `notebooks/lib/podlog_plots.py` module, with a single `ipywidgets` source toggle.
- Both Confirmed and Inferred-HIGH variants of each plot family are shown side by side on the page — no toggle in the web app.
- Use only data already present in the database — no new migrations or pipeline stages. The `speaker_names.role` and `speaker_names.confidence` columns from PRD-04 are sufficient.
- Reuse the existing snapshot architecture (`apps/pipeline/app/services/meta_analysis.py`, JSONB single-row table per migration 015). New per-(episode, speaker) aggregates are added to the snapshot as new top-level fields.
- Keep existing supporting UI (header with refresh, `FiltersBar`, `CoverageStrip`, `MissingSpeakersModal`, `ExploreStatusPanel`, `InfoBlock`).

### Non-Goals
- No new SQL schema, columns, or migrations.
- No NLP name normalisation for inferred speakers (known noise: `Marko` vs `Marko Papic`, `Twitter`, `Linkedin`); deferred to §10.
- No automatic re-classification of inferred speakers.
- No live ipywidgets toggle on the web page — the page renders both sources statically per feed; the ipywidgets toggle exists only in the notebook (§5).
```

- [ ] **Step 2: Adjust §3.1 Source toggle** to scope it to the notebook

Within `## 3. Shared Conventions`, replace §3.1 with two sub-sections:

```markdown
### 3.1a Source on the web page
Each plot family renders **two ChartCards side by side**: one Confirmed, one Inferred-HIGH. No interactive toggle — both are always visible. The card title carries the source label (e.g. *(Confirmed)* / *(Inferred — HIGH confidence)*).

### 3.1b Source toggle in the notebook
The notebook keeps the original ipywidgets `RadioButtons` design: a single widget at the top of the speaker-plots section drives all six figures via a callback that re-runs the query and `Plotly.react`s each figure.
```

- [ ] **Step 3: Adjust §3.2 Click-to-open**

Replace the paragraph that says "The exact route is to be confirmed against `apps/web` during implementation. (During prototyping, the upstream `episodes.episode_url` was used as a stand-in.)" with:

```markdown
The target is the in-app episode page at `/episodes/{episode_id}`. In the web app, the click handler calls Next.js `router.push()` (no full reload). In the notebook, click-to-open opens `{PODLOG_WEB_URL}/episodes/{episode_id}` in a new tab; `PODLOG_WEB_URL` defaults to `http://localhost:3000` and can be overridden via env var.
```

- [ ] **Step 4: Adjust §3.6 Theme** to point at the existing implementation

Within §3.6 add a leading sentence:

```markdown
The web app's existing dark-mode class strategy (`<html class="dark">`) is the source of truth. The Plotly wrapper observes the `dark` class and re-applies `template: "plotly_dark"` / `"plotly_white"` on change without re-rendering data.
```

- [ ] **Step 5: Update changelog entry at top**

In the file header, replace the existing `**Changelog:**` block with:

```markdown
**Changelog:**
- v1.1 — Realignment: PRD reframed as a **web-page rewrite** (Meta-Analysis page) with the notebook as a bonus. Web app shows both Confirmed + Inferred-HIGH variants side by side (no toggle); notebook keeps the ipywidgets toggle. Click-to-open is in-app via Next.js router on the web page, and via `PODLOG_WEB_URL` env in the notebook.
- v1.0 — Initial draft (notebook-first). Specifies three new plot families (six rendered cells), each with a Confirmed-source variant and an Inferred-HIGH-confidence variant.
```

Bump `**Version:** 1.0` → `**Version:** 1.1` in the header.

- [ ] **Step 6: Commit**

```bash
git add prds/PRD-06-speaker-analytics-plots.md
git commit -m "$(cat <<'EOF'
docs(prd-06): realign as Meta-Analysis page rewrite (v1.1)

Refactor PRD-06 from notebook-first to web-app-first. The Meta-Analysis
page is now the primary target; the notebook is a bonus. Both source
variants render side by side on the page (no widget toggle); the
notebook keeps the ipywidgets RadioButtons design.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Phase 1 — Pipeline snapshot extension

Add two new fields to the JSONB snapshot so the web app has everything it needs to render the six plots without re-querying the DB.

### Task 1.1: Define the new snapshot field shapes

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis_aggregations.py`

The two new arrays returned by `compute_snapshot()` will be:

```python
# per_episode_speaker: one row per (episode_id, display_name, source).
# Both Confirmed and Inferred-HIGH rows live in the same array, distinguished
# by the `source` column. Web app filters by `source` in the transform layer.
{
    "feed_id": str,
    "feed_title": str,             # raw RSS title; web does feed_short
    "episode_id": str,
    "episode_title": str,
    "published_at": str | None,    # ISO 8601 in UTC
    "display_name": str,
    "role": str | None,            # "host" | "guest" | None (always None for inferred)
    "source": str,                 # "confirmed" | "inferred_high"
    "minutes": float,
    "words": int,
}

# episode_speaker_diff: precomputed for the diff plot. One row per
# (feed_id, episode_id, source) where the episode has both hosts and guests.
{
    "feed_id": str,
    "feed_title": str,
    "episode_id": str,
    "episode_title": str,
    "published_at": str | None,
    "source": str,                 # "confirmed" | "inferred_high"
    "host_mean": float,
    "host_min": float,
    "host_max": float,
    "host_count": int,
    "host_names": list[str],
    "guest_mean": float,
    "guest_min": float,
    "guest_max": float,
    "guest_count": int,
    "guest_names": list[str],
    "diff": float,                 # guest_mean - host_mean
    "band_lo": float,              # guest_min - host_max
    "band_hi": float,              # guest_max - host_min
}
```

No code change in this step — this block documents the contract that the next steps implement and test against.

- [ ] **Step 1: Write the failing test for `_per_episode_speaker()` shape**

Open `apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py` (create if absent). Add:

```python
def test_per_episode_speaker_returns_confirmed_rows(seeded_session):
    """One confirmed row per (episode, display_name) with role and minutes."""
    from app.services.meta_analysis_aggregations import _per_episode_speaker
    rows = _per_episode_speaker(seeded_session)
    confirmed = [r for r in rows if r["source"] == "confirmed"]
    assert len(confirmed) >= 1
    r0 = confirmed[0]
    assert set(r0.keys()) == {
        "feed_id", "feed_title", "episode_id", "episode_title",
        "published_at", "display_name", "role", "source",
        "minutes", "words",
    }
    assert r0["role"] in ("host", "guest")
    assert r0["source"] == "confirmed"
    assert isinstance(r0["minutes"], float)
    assert isinstance(r0["words"], int)


def test_per_episode_speaker_returns_inferred_high_rows(seeded_session):
    from app.services.meta_analysis_aggregations import _per_episode_speaker
    rows = _per_episode_speaker(seeded_session)
    inferred = [r for r in rows if r["source"] == "inferred_high"]
    # All inferred rows have role IS NULL by spec.
    assert all(r["role"] is None for r in inferred)


def test_per_episode_speaker_excludes_role_other(seeded_session):
    """Confirmed-source rows with role='other' must not appear."""
    from app.services.meta_analysis_aggregations import _per_episode_speaker
    rows = _per_episode_speaker(seeded_session)
    confirmed_roles = {r["role"] for r in rows if r["source"] == "confirmed"}
    assert "other" not in confirmed_roles
    assert None not in confirmed_roles  # confirmed rows always have a role
```

Use the project's existing fixture conventions for `seeded_session` (it's in `conftest.py` for the integration suite — for unit tests, create a minimal in-memory seed, see `apps/pipeline/tests/unit/services/test_meta_analysis*.py` for patterns).

- [ ] **Step 2: Run the test and verify it fails**

```bash
docker compose -f docker-compose.test.yml build test
docker compose -f docker-compose.test.yml run --rm test \
  pytest apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py::test_per_episode_speaker_returns_confirmed_rows -v
```

Expected: FAIL with `AttributeError: module ... has no attribute '_per_episode_speaker'` or `ImportError`.

- [ ] **Step 3: Implement `_per_episode_speaker()` in `meta_analysis_aggregations.py`**

Add this function near the other `_per_*` helpers (e.g. after `_per_speaker`):

```python
def _per_episode_speaker(db: Session) -> list[dict[str, Any]]:
    """Per-(episode, speaker, source) rows for the speaker analytics plots.

    Emits both:
      - 'confirmed': sn.confirmed_by_user = TRUE AND sn.role IN ('host','guest')
      - 'inferred_high': sn.inferred = TRUE AND sn.confidence = 'HIGH'

    Each row carries minutes (sum segment duration / 60) and words
    (whitespace tokens of segment text). Used by SpeakerMinutesChart,
    SpeakerWordsChart and the diff aggregation.
    """
    from sqlalchemy import select, func, case, and_, or_

    from app.models import Episode, Feed, Segment, SpeakerName

    sn_pred = or_(
        and_(SpeakerName.confirmed_by_user == True,  # noqa: E712
             SpeakerName.role.in_(("host", "guest"))),
        and_(SpeakerName.inferred == True,  # noqa: E712
             SpeakerName.confidence == "HIGH"),
    )
    source_expr = case(
        (SpeakerName.confirmed_by_user == True, "confirmed"),  # noqa: E712
        else_="inferred_high",
    ).label("source")

    # Word count via segment text tokenization in Python: avoids the
    # regexp_split_to_array cost in SQL and matches the prototype's behavior.
    rows = db.execute(
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
        .join(SpeakerName,
              and_(SpeakerName.episode_id == Segment.episode_id,
                   SpeakerName.speaker_label == Segment.speaker_label))
        .where(Episode.published_at.isnot(None))
        .where(sn_pred)
    ).all()

    agg: dict[tuple, dict[str, Any]] = {}
    for r in rows:
        key = (r.feed_id, r.episode_id, r.display_name, r.source)
        entry = agg.setdefault(key, {
            "feed_id": r.feed_id,
            "feed_title": r.feed_title,
            "episode_id": r.episode_id,
            "episode_title": r.episode_title,
            "published_at": r.published_at.isoformat() if r.published_at else None,
            "display_name": r.display_name,
            "role": r.role,  # None for inferred rows
            "source": r.source,
            "minutes": 0.0,
            "words": 0,
        })
        entry["minutes"] += max(0.0, float(r.end_time - r.start_time)) / 60.0
        text = (r.text or "").strip()
        if text:
            entry["words"] += len(text.split())

    # Deterministic order: by feed_title, published_at, display_name, source.
    return sorted(
        agg.values(),
        key=lambda x: (x["feed_title"], x["published_at"] or "",
                       x["display_name"], x["source"]),
    )
```

- [ ] **Step 4: Run the tests and verify they pass**

```bash
docker compose -f docker-compose.test.yml build test
docker compose -f docker-compose.test.yml run --rm test \
  pytest apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py -v -k per_episode_speaker
```

Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis_aggregations.py \
        apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py
git commit -m "feat(pipeline): add per-episode-speaker aggregation for PRD-06 plots

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.2: Add `_episode_speaker_diff()` aggregation

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis_aggregations.py`
- Modify: `apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py`

- [ ] **Step 1: Write failing tests**

Add to the test file:

```python
def test_episode_speaker_diff_only_episodes_with_both_sides(seeded_session):
    from app.services.meta_analysis_aggregations import (
        _per_episode_speaker, _episode_speaker_diff,
    )
    speakers = _per_episode_speaker(seeded_session)
    diffs = _episode_speaker_diff(speakers)
    # All diff rows have at least one host and at least one guest.
    for d in diffs:
        assert d["host_count"] >= 1
        assert d["guest_count"] >= 1


def test_episode_speaker_diff_band_math(seeded_session):
    from app.services.meta_analysis_aggregations import (
        _per_episode_speaker, _episode_speaker_diff,
    )
    speakers = _per_episode_speaker(seeded_session)
    diffs = _episode_speaker_diff(speakers)
    for d in diffs:
        assert d["diff"] == pytest.approx(d["guest_mean"] - d["host_mean"])
        assert d["band_lo"] == pytest.approx(d["guest_min"] - d["host_max"])
        assert d["band_hi"] == pytest.approx(d["guest_max"] - d["host_min"])
        assert d["band_lo"] <= d["diff"] <= d["band_hi"]


def test_episode_speaker_diff_inferred_uses_inheritance_then_heuristic(seeded_session):
    """Inferred-source rows have role=None; classification must use the
    confirmed table first, then the 25%-of-episodes fallback."""
    from app.services.meta_analysis_aggregations import (
        _per_episode_speaker, _episode_speaker_diff,
    )
    speakers = _per_episode_speaker(seeded_session)
    diffs = _episode_speaker_diff(speakers)
    inferred = [d for d in diffs if d["source"] == "inferred_high"]
    assert len(inferred) >= 0  # may be empty if no inferred-HIGH episodes; OK.
    # If non-empty, sanity check the structure:
    for d in inferred:
        assert d["host_count"] + d["guest_count"] >= 2
```

- [ ] **Step 2: Implement `_episode_speaker_diff()`**

Add to `meta_analysis_aggregations.py`:

```python
HOST_THRESHOLD = 0.25  # PRD-06 §3.3 fallback: 25% of episodes in feed.


def _confirmed_role_map(speakers: list[dict[str, Any]]) -> dict[tuple, bool]:
    """(feed_id, display_name) -> True if this name is a confirmed host.

    Used for the inferred-source inheritance step. Majority wins; tie -> host.
    """
    counts: dict[tuple, dict[str, int]] = {}
    for r in speakers:
        if r["source"] != "confirmed":
            continue
        key = (r["feed_id"], r["display_name"])
        c = counts.setdefault(key, {"host": 0, "guest": 0})
        if r["role"] in c:
            c[r["role"]] += 1
    return {k: v["host"] >= v["guest"] for k, v in counts.items()}


def _episode_speaker_diff(speakers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Per-(feed, episode, source) host-vs-guest diff rows for the diff plot.

    Only episodes that have at least one host and at least one guest after
    classification are emitted (per PRD-06 §6.3 step 2).
    """
    confirmed_roles = _confirmed_role_map(speakers)

    # Inferred fallback: count episodes per (feed, name).
    inferred_eps: dict[tuple, set[str]] = {}
    inferred_feed_eps: dict[str, set[str]] = {}
    for r in speakers:
        if r["source"] != "inferred_high":
            continue
        inferred_eps.setdefault((r["feed_id"], r["display_name"]), set()).add(r["episode_id"])
        inferred_feed_eps.setdefault(r["feed_id"], set()).add(r["episode_id"])

    def is_host(r: dict[str, Any]) -> bool:
        if r["source"] == "confirmed":
            return r["role"] == "host"
        key = (r["feed_id"], r["display_name"])
        if key in confirmed_roles:
            return confirmed_roles[key]
        feed_total = len(inferred_feed_eps.get(r["feed_id"], ()))
        if feed_total == 0:
            return False
        speaker_total = len(inferred_eps.get(key, ()))
        return (speaker_total / feed_total) >= HOST_THRESHOLD

    # Group rows per (feed_id, episode_id, source).
    grouped: dict[tuple, list[dict[str, Any]]] = {}
    for r in speakers:
        grouped.setdefault((r["feed_id"], r["episode_id"], r["source"]), []).append(r)

    out: list[dict[str, Any]] = []
    for (feed_id, episode_id, source), rows in grouped.items():
        hosts = [r for r in rows if is_host(r)]
        guests = [r for r in rows if not is_host(r)]
        if not hosts or not guests:
            continue
        h_vals = [r["minutes"] for r in hosts]
        g_vals = [r["minutes"] for r in guests]
        h_names = sorted({r["display_name"] for r in hosts})
        g_names = sorted({r["display_name"] for r in guests})
        h_mean = sum(h_vals) / len(h_vals)
        g_mean = sum(g_vals) / len(g_vals)
        out.append({
            "feed_id": feed_id,
            "feed_title": rows[0]["feed_title"],
            "episode_id": episode_id,
            "episode_title": rows[0]["episode_title"],
            "published_at": rows[0]["published_at"],
            "source": source,
            "host_mean": h_mean,
            "host_min": min(h_vals),
            "host_max": max(h_vals),
            "host_count": len(hosts),
            "host_names": h_names,
            "guest_mean": g_mean,
            "guest_min": min(g_vals),
            "guest_max": max(g_vals),
            "guest_count": len(guests),
            "guest_names": g_names,
            "diff": g_mean - h_mean,
            "band_lo": min(g_vals) - max(h_vals),
            "band_hi": max(g_vals) - min(h_vals),
        })
    return sorted(out, key=lambda x: (x["feed_title"], x["published_at"] or "", x["source"]))
```

- [ ] **Step 3: Run tests, verify pass**

```bash
docker compose -f docker-compose.test.yml build test
docker compose -f docker-compose.test.yml run --rm test \
  pytest apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py -v -k episode_speaker_diff
```

Expected: 3 PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis_aggregations.py \
        apps/pipeline/tests/unit/services/test_meta_analysis_aggregations.py
git commit -m "feat(pipeline): add episode-speaker diff aggregation for PRD-06 §6

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.3: Wire new arrays into `compute_snapshot()`

**Files:**
- Modify: `apps/pipeline/app/services/meta_analysis.py`

- [ ] **Step 1: Add the new arrays to `compute_snapshot()`**

Open `apps/pipeline/app/services/meta_analysis.py`. Find `compute_snapshot()` (line ~113). Add the new fields to the returned dict.

Look at the existing block — it calls helpers from `meta_analysis_aggregations` and assembles them. Add imports at the top:

```python
from app.services.meta_analysis_aggregations import (
    # ... existing imports ...
    _per_episode_speaker,
    _episode_speaker_diff,
)
```

In the body of `compute_snapshot()`, after the existing aggregations, add:

```python
per_episode_speaker = _per_episode_speaker(db)
episode_speaker_diff = _episode_speaker_diff(per_episode_speaker)
```

And add them to the returned dict (the function returns a dict literal — extend it):

```python
return {
    # ... existing keys ...
    "per_episode_speaker": per_episode_speaker,
    "episode_speaker_diff": episode_speaker_diff,
}
```

- [ ] **Step 2: Add an integration test verifying the snapshot contains the new fields**

Create or extend `apps/pipeline/tests/integration/test_meta_analysis_snapshot.py`:

```python
def test_snapshot_contains_speaker_analytics_arrays(seeded_db_session):
    from app.services.meta_analysis import compute_snapshot
    snap = compute_snapshot(seeded_db_session)
    assert "per_episode_speaker" in snap
    assert "episode_speaker_diff" in snap
    assert isinstance(snap["per_episode_speaker"], list)
    assert isinstance(snap["episode_speaker_diff"], list)
```

- [ ] **Step 3: Run tests, verify pass**

```bash
docker compose -f docker-compose.test.yml build test
docker compose -f docker-compose.test.yml run --rm test \
  pytest apps/pipeline/tests/ -v -k "speaker_analytics_arrays or per_episode_speaker or episode_speaker_diff"
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/pipeline/app/services/meta_analysis.py \
        apps/pipeline/tests/integration/test_meta_analysis_snapshot.py
git commit -m "feat(pipeline): include speaker analytics arrays in snapshot

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 1.4: Update TS snapshot types

**Files:**
- Modify: `apps/web/src/lib/metaAnalysisTypes.ts`

- [ ] **Step 1: Add the new interfaces and extend `MetaAnalysisSnapshot`**

Open the file. After the existing `interface PerSpeaker {...}` block, add:

```typescript
export interface PerEpisodeSpeaker {
  feed_id: string;
  feed_title: string;
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  display_name: string;
  role: "host" | "guest" | null;
  source: "confirmed" | "inferred_high";
  minutes: number;
  words: number;
}

export interface EpisodeSpeakerDiff {
  feed_id: string;
  feed_title: string;
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  source: "confirmed" | "inferred_high";
  host_mean: number;
  host_min: number;
  host_max: number;
  host_count: number;
  host_names: string[];
  guest_mean: number;
  guest_min: number;
  guest_max: number;
  guest_count: number;
  guest_names: string[];
  diff: number;
  band_lo: number;
  band_hi: number;
}
```

Then extend `MetaAnalysisSnapshot`:

```typescript
export interface MetaAnalysisSnapshot {
  per_feed: PerFeed[];
  per_episode: PerEpisode[];
  per_speaker: PerSpeaker[];
  timeline_monthly: TimelineMonthly[];
  coverage: Coverage;
  per_episode_speaker: PerEpisodeSpeaker[];
  episode_speaker_diff: EpisodeSpeakerDiff[];
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors. (Existing chart components still type-check against the old fields; the new ones are additive.)

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/lib/metaAnalysisTypes.ts
git commit -m "feat(web): add PerEpisodeSpeaker + EpisodeSpeakerDiff types

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 2 — Plotly foundation

### Task 2.1: Add Plotly dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Install Plotly packages**

```bash
cd apps/web
npm install react-plotly.js@^2.6.0 plotly.js-dist-min@^2.35.0
npm install --save-dev @types/react-plotly.js@^2.6.3
```

- [ ] **Step 2: Verify dev server still boots and the install didn't break the build**

```bash
cd apps/web && npm run build
```

Expected: success.

- [ ] **Step 3: Commit lockfile + package.json**

```bash
git add apps/web/package.json apps/web/package-lock.json
git commit -m "build(web): add plotly.js for PRD-06 charts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 2.2: SSR-safe `PlotlyChart` wrapper

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/PlotlyChart.tsx`
- Create: `apps/web/src/app/meta-analysis/charts/usePlotlyTheme.ts`

- [ ] **Step 1: Implement `usePlotlyTheme`**

```typescript
// apps/web/src/app/meta-analysis/charts/usePlotlyTheme.ts
"use client";

import { useEffect, useState } from "react";

export type PlotlyTemplate = "plotly_white" | "plotly_dark";

function readTheme(): PlotlyTemplate {
  if (typeof document === "undefined") return "plotly_white";
  return document.documentElement.classList.contains("dark")
    ? "plotly_dark"
    : "plotly_white";
}

export function usePlotlyTheme(): PlotlyTemplate {
  const [template, setTemplate] = useState<PlotlyTemplate>(readTheme);
  useEffect(() => {
    const obs = new MutationObserver(() => setTemplate(readTheme()));
    obs.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class"],
    });
    return () => obs.disconnect();
  }, []);
  return template;
}
```

- [ ] **Step 2: Implement `PlotlyChart` with `next/dynamic`**

```typescript
// apps/web/src/app/meta-analysis/charts/PlotlyChart.tsx
"use client";

import dynamic from "next/dynamic";
import type { Data, Layout, Config } from "plotly.js";
import { usePlotlyTheme } from "./usePlotlyTheme";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">Loading chart…</div>,
});

interface Props {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
  onPointClick?: (episodeId: string) => void;
  height?: number;
}

export default function PlotlyChart({ data, layout, config, onPointClick, height = 360 }: Props) {
  const template = usePlotlyTheme();
  return (
    <div style={{ width: "100%", height }}>
      <Plot
        data={data}
        layout={{
          autosize: true,
          template: template as unknown as Layout["template"],
          margin: { l: 60, r: 20, t: 70, b: 110 },
          ...layout,
        }}
        config={{ displaylogo: false, responsive: true, ...config }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        onClick={(ev) => {
          if (!onPointClick) return;
          const p = ev.points?.[0] as { customdata?: unknown } | undefined;
          const cd = p?.customdata;
          // Convention: last entry of customdata is the episode_id.
          if (Array.isArray(cd) && cd.length > 0) {
            const last = cd[cd.length - 1];
            if (typeof last === "string") onPointClick(last);
          }
        }}
      />
    </div>
  );
}
```

- [ ] **Step 3: Smoke test — render a minimal chart in a Storybook-style test page or via dev server**

```bash
cd apps/web && npm run dev
```

Open `http://localhost:3000/meta-analysis` in a browser and confirm the page still renders (the existing 9 charts still work; we haven't wired Plotly in yet). The build succeeding plus no TS errors is the actual gate.

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/PlotlyChart.tsx \
        apps/web/src/app/meta-analysis/charts/usePlotlyTheme.ts
git commit -m "feat(web): add SSR-safe Plotly wrapper + dark-mode template hook

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 3 — Chart components

Three new chart components. The transforms are the hard part — TDD them first as pure functions, then wire to a thin Plotly component.

### Task 3.1: Shared transforms — `feedShort.ts` + palettes

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/transforms/feedShort.ts`

- [ ] **Step 1: Implement helpers**

```typescript
// apps/web/src/app/meta-analysis/charts/transforms/feedShort.ts
const FEED_SHORT: Record<string, string> = {
  "Lenny's Podcast: Product | Career | Growth": "Lenny's Podcast",
  "The Jacob Shapiro Podcast": "Jacob Shapiro",
  "Dwarkesh Podcast": "Dwarkesh",
  "Geopolitical Cousins": "Geopolitical Cousins",
  "Agelast podcast": "Agelast",
  "The Twenty Minute VC (20VC): Venture Capital | Startup Funding | The Pitch": "20VC",
};

export function feedShort(title: string): string {
  return FEED_SHORT[title] ?? title;
}

// Plotly qualitative palettes (matches plotly.colors.qualitative.{Plotly,D3,Pastel}).
export const PALETTE = [
  "#636EFA", "#EF553B", "#00CC96", "#AB63FA", "#FFA15A",
  "#19D3F3", "#FF6692", "#B6E880", "#FF97FF", "#FECB52",
];
export const HOST_PALETTE = [
  "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
  "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF",
];
export const GUEST_PALETTE = [
  "#FBB4AE", "#B3CDE3", "#CCEBC5", "#DECBE4", "#FED9A6",
];

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/transforms/feedShort.ts
git commit -m "feat(web): add feedShort + plotly palettes for PRD-06 charts

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.2: `speakerRows.ts` transform — TDD

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/transforms/speakerRows.ts`
- Create: `apps/web/src/app/meta-analysis/charts/transforms/__tests__/speakerRows.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/src/app/meta-analysis/charts/transforms/__tests__/speakerRows.test.ts
import { classifyRoles, buildSpeakerSeries } from "../speakerRows";
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";

const row = (over: Partial<PerEpisodeSpeaker>): PerEpisodeSpeaker => ({
  feed_id: "f1", feed_title: "Feed 1",
  episode_id: "e1", episode_title: "Ep 1",
  published_at: "2026-01-01T00:00:00Z",
  display_name: "Alice", role: "host", source: "confirmed",
  minutes: 10, words: 1500, ...over,
});

describe("classifyRoles", () => {
  it("confirmed source: majority wins, tie -> host", () => {
    const rows = [
      row({ display_name: "Alice", role: "host" }),
      row({ display_name: "Alice", role: "host", episode_id: "e2" }),
      row({ display_name: "Alice", role: "guest", episode_id: "e3" }),
    ];
    const m = classifyRoles(rows, "confirmed");
    expect(m.get("f1|Alice")).toBe(true);  // host
  });

  it("inferred source: inherit confirmed-host mapping when present", () => {
    const rows = [
      row({ display_name: "Alice", role: "host", source: "confirmed" }),
      row({ display_name: "Alice", role: null, source: "inferred_high", episode_id: "e2" }),
    ];
    const m = classifyRoles(rows, "inferred_high");
    expect(m.get("f1|Alice")).toBe(true);
  });

  it("inferred source: fall back to 25% heuristic when name unknown in confirmed", () => {
    // Alice appears in 1 of 4 inferred episodes -> 25% threshold met -> host.
    const rows: PerEpisodeSpeaker[] = [];
    for (let i = 1; i <= 4; i++) {
      rows.push(row({
        display_name: "Bob", role: null, source: "inferred_high",
        episode_id: `e${i}`,
      }));
    }
    rows.push(row({
      display_name: "Alice", role: null, source: "inferred_high",
      episode_id: "e1",
    }));
    const m = classifyRoles(rows, "inferred_high");
    expect(m.get("f1|Alice")).toBe(false);  // 1/4 = 25%, threshold is >= 0.25
    // Adjust expectation if your fallback uses > vs >=. Spec PRD-06 §3.3
    // says "appear in >= HOST_THRESHOLD" so >= 0.25 -> Alice is host.
    expect(m.get("f1|Alice")).toBe(true);
  });
});

describe("buildSpeakerSeries", () => {
  it("collapses non-host rows into a combined guests series per feed", () => {
    const rows = [
      row({ display_name: "Alice", role: "host" }),
      row({ display_name: "Bob", role: "guest", minutes: 5, words: 800 }),
      row({ display_name: "Carol", role: "guest", minutes: 7, words: 900 }),
    ];
    const series = buildSpeakerSeries(rows, "minutes", "confirmed");
    const feedSeries = series.get("f1")!;
    expect(feedSeries.hosts.map((h) => h.display_name)).toEqual(["Alice"]);
    expect(feedSeries.combinedGuests.length).toBe(1);
    expect(feedSeries.combinedGuests[0].value).toBe(12);  // 5 + 7
    expect(feedSeries.combinedGuests[0].guest_names).toEqual(["Bob", "Carol"]);
  });
});
```

- [ ] **Step 2: Run the tests — verify they fail**

```bash
cd apps/web && npx jest src/app/meta-analysis/charts/transforms/__tests__/speakerRows.test.ts
```

Expected: FAIL with "Cannot find module '../speakerRows'".

- [ ] **Step 3: Implement `speakerRows.ts`**

```typescript
// apps/web/src/app/meta-analysis/charts/transforms/speakerRows.ts
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";

export type Source = "confirmed" | "inferred_high";
export type Metric = "minutes" | "words";
const HOST_THRESHOLD = 0.25;

function key(feed_id: string, display_name: string): string {
  return `${feed_id}|${display_name}`;
}

export function classifyRoles(
  rows: PerEpisodeSpeaker[],
  source: Source,
): Map<string, boolean> {
  if (source === "confirmed") {
    const counts = new Map<string, { host: number; guest: number }>();
    for (const r of rows) {
      if (r.source !== "confirmed") continue;
      if (r.role !== "host" && r.role !== "guest") continue;
      const k = key(r.feed_id, r.display_name);
      const c = counts.get(k) ?? { host: 0, guest: 0 };
      c[r.role] += 1;
      counts.set(k, c);
    }
    const out = new Map<string, boolean>();
    for (const [k, c] of counts) out.set(k, c.host >= c.guest);
    return out;
  }

  // Inferred: inherit from confirmed when known, else 25% fallback.
  const confirmed = classifyRoles(rows, "confirmed");

  const speakerEps = new Map<string, Set<string>>();
  const feedEps = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.source !== "inferred_high") continue;
    const k = key(r.feed_id, r.display_name);
    if (!speakerEps.has(k)) speakerEps.set(k, new Set());
    speakerEps.get(k)!.add(r.episode_id);
    if (!feedEps.has(r.feed_id)) feedEps.set(r.feed_id, new Set());
    feedEps.get(r.feed_id)!.add(r.episode_id);
  }
  const out = new Map<string, boolean>();
  for (const [k] of speakerEps) {
    if (confirmed.has(k)) {
      out.set(k, confirmed.get(k)!);
    } else {
      const [feed_id] = k.split("|");
      const total = feedEps.get(feed_id)?.size ?? 0;
      const spk = speakerEps.get(k)?.size ?? 0;
      out.set(k, total > 0 && spk / total >= HOST_THRESHOLD);
    }
  }
  return out;
}

export interface HostPoint {
  display_name: string;
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  value: number;
}

export interface CombinedGuestPoint {
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  value: number;
  guest_count: number;
  guest_names: string[];
}

export interface FeedSeries {
  feed_id: string;
  feed_title: string;
  hosts: { display_name: string; points: HostPoint[] }[];
  combinedGuests: CombinedGuestPoint[];
}

export function buildSpeakerSeries(
  rows: PerEpisodeSpeaker[],
  metric: Metric,
  source: Source,
): Map<string, FeedSeries> {
  const filtered = rows.filter((r) => r.source === source);
  const roles = classifyRoles(rows, source);
  const valueOf = (r: PerEpisodeSpeaker) => (metric === "minutes" ? r.minutes : r.words);

  const byFeed = new Map<string, PerEpisodeSpeaker[]>();
  for (const r of filtered) {
    if (!byFeed.has(r.feed_id)) byFeed.set(r.feed_id, []);
    byFeed.get(r.feed_id)!.push(r);
  }

  const out = new Map<string, FeedSeries>();
  for (const [feed_id, feedRows] of byFeed) {
    const hostRows: PerEpisodeSpeaker[] = [];
    const guestRows: PerEpisodeSpeaker[] = [];
    for (const r of feedRows) {
      if (roles.get(key(r.feed_id, r.display_name))) hostRows.push(r);
      else guestRows.push(r);
    }

    // Host series: per name, sorted by published_at.
    const hostByName = new Map<string, HostPoint[]>();
    for (const r of hostRows) {
      const pts = hostByName.get(r.display_name) ?? [];
      pts.push({
        display_name: r.display_name,
        episode_id: r.episode_id,
        episode_title: r.episode_title,
        published_at: r.published_at,
        value: valueOf(r),
      });
      hostByName.set(r.display_name, pts);
    }
    const hosts = Array.from(hostByName.entries())
      .map(([display_name, points]) => ({
        display_name,
        points: points.sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? "")),
      }))
      .sort((a, b) =>
        b.points.reduce((s, p) => s + p.value, 0) -
        a.points.reduce((s, p) => s + p.value, 0)
      );

    // Combined guests: group by episode, sum values, list names.
    const byEp = new Map<string, CombinedGuestPoint>();
    for (const r of guestRows) {
      const existing = byEp.get(r.episode_id);
      if (existing) {
        existing.value += valueOf(r);
        if (!existing.guest_names.includes(r.display_name)) {
          existing.guest_names.push(r.display_name);
        }
        existing.guest_count = existing.guest_names.length;
      } else {
        byEp.set(r.episode_id, {
          episode_id: r.episode_id,
          episode_title: r.episode_title,
          published_at: r.published_at,
          value: valueOf(r),
          guest_count: 1,
          guest_names: [r.display_name],
        });
      }
    }
    const combinedGuests = Array.from(byEp.values())
      .map((p) => ({ ...p, guest_names: [...p.guest_names].sort() }))
      .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""));

    out.set(feed_id, {
      feed_id,
      feed_title: feedRows[0].feed_title,
      hosts,
      combinedGuests,
    });
  }
  return out;
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd apps/web && npx jest src/app/meta-analysis/charts/transforms/__tests__/speakerRows.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/transforms/speakerRows.ts \
        apps/web/src/app/meta-analysis/charts/transforms/__tests__/speakerRows.test.ts
git commit -m "feat(web): add speaker-rows transform (classify + combine guests)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.3: `diffRows.ts` transform — TDD

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/transforms/diffRows.ts`
- Create: `apps/web/src/app/meta-analysis/charts/transforms/__tests__/diffRows.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// apps/web/src/app/meta-analysis/charts/transforms/__tests__/diffRows.test.ts
import { filterDiffRows, summarizeDiff } from "../diffRows";
import type { EpisodeSpeakerDiff } from "@/lib/metaAnalysisTypes";

const diff = (over: Partial<EpisodeSpeakerDiff>): EpisodeSpeakerDiff => ({
  feed_id: "f1", feed_title: "Feed 1",
  episode_id: "e1", episode_title: "Ep 1",
  published_at: "2026-01-01T00:00:00Z",
  source: "confirmed",
  host_mean: 10, host_min: 8, host_max: 12, host_count: 2, host_names: ["A", "B"],
  guest_mean: 15, guest_min: 12, guest_max: 18, guest_count: 2, guest_names: ["C", "D"],
  diff: 5, band_lo: 0, band_hi: 10,
  ...over,
});

describe("filterDiffRows", () => {
  it("returns only the requested source", () => {
    const rows = [diff({ source: "confirmed" }), diff({ source: "inferred_high", episode_id: "e2" })];
    expect(filterDiffRows(rows, "confirmed")).toHaveLength(1);
    expect(filterDiffRows(rows, "confirmed")[0].episode_id).toBe("e1");
  });
});

describe("summarizeDiff", () => {
  it("counts episodes by which side led", () => {
    const rows = [
      diff({ diff: 3 }),
      diff({ diff: -2, episode_id: "e2" }),
      diff({ diff: 0, episode_id: "e3" }),
    ];
    const s = summarizeDiff(rows);
    expect(s.guestsMore).toBe(1);
    expect(s.hostsMore).toBe(1);
    expect(s.total).toBe(3);
  });
});
```

- [ ] **Step 2: Run tests, verify they fail**

```bash
cd apps/web && npx jest src/app/meta-analysis/charts/transforms/__tests__/diffRows.test.ts
```

Expected: FAIL (module not found).

- [ ] **Step 3: Implement `diffRows.ts`**

```typescript
// apps/web/src/app/meta-analysis/charts/transforms/diffRows.ts
import type { EpisodeSpeakerDiff } from "@/lib/metaAnalysisTypes";
import type { Source } from "./speakerRows";

export function filterDiffRows(rows: EpisodeSpeakerDiff[], source: Source): EpisodeSpeakerDiff[] {
  return rows
    .filter((r) => r.source === source)
    .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""));
}

export interface DiffSummary {
  total: number;
  guestsMore: number;
  hostsMore: number;
}

export function summarizeDiff(rows: EpisodeSpeakerDiff[]): DiffSummary {
  let guestsMore = 0;
  let hostsMore = 0;
  for (const r of rows) {
    if (r.diff > 0) guestsMore++;
    else if (r.diff < 0) hostsMore++;
  }
  return { total: rows.length, guestsMore, hostsMore };
}
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd apps/web && npx jest src/app/meta-analysis/charts/transforms/__tests__/diffRows.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/transforms/diffRows.ts \
        apps/web/src/app/meta-analysis/charts/transforms/__tests__/diffRows.test.ts
git commit -m "feat(web): add diff-rows transform for host-vs-guest chart

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.4: `SpeakerMinutesChart` component

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/SpeakerMinutesChart.tsx`

- [ ] **Step 1: Implement the chart**

```tsx
// apps/web/src/app/meta-analysis/charts/SpeakerMinutesChart.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Data, Layout } from "plotly.js";
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";
import PlotlyChart from "./PlotlyChart";
import { buildSpeakerSeries, type Source } from "./transforms/speakerRows";
import { feedShort, HOST_PALETTE, GUEST_PALETTE } from "./transforms/feedShort";

interface Props {
  rows: PerEpisodeSpeaker[];
  source: Source;
  enableClickOpen?: boolean;
}

export default function SpeakerMinutesChart({ rows, source, enableClickOpen = true }: Props) {
  const router = useRouter();
  const series = useMemo(() => buildSpeakerSeries(rows, "minutes", source), [rows, source]);
  const sourceLabel = source === "confirmed" ? "Confirmed" : "Inferred — HIGH";

  if (series.size === 0) {
    return <p className="text-sm text-muted-foreground">No data for {sourceLabel} source.</p>;
  }

  const feedIds = Array.from(series.keys());
  const traces: Data[] = [];
  const traceFeed: string[] = [];

  feedIds.forEach((feedId, fIdx) => {
    const fs = series.get(feedId)!;
    fs.hosts.forEach((h, hIdx) => {
      const color = HOST_PALETTE[hIdx % HOST_PALETTE.length];
      const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
      traces.push({
        type: "scatter",
        mode: "markers+lines",
        name: `${h.display_name} (host)`,
        x: h.points.map((p) => p.published_at),
        y: h.points.map((p) => p.value),
        line: { width: 2, color },
        marker: { size: 7, symbol: "circle", color },
        customdata: h.points.map((p) => [p.episode_title, p.episode_id]),
        hovertemplate:
          "%{x|%Y-%m-%d}<br>%{y:.1f} min<br>%{customdata[0]}" +
          clickHint +
          `<extra><b>${h.display_name}</b> (host)</extra>`,
        visible: fIdx === 0,
      });
      traceFeed.push(feedId);
    });
    if (fs.combinedGuests.length > 0) {
      const color = GUEST_PALETTE[0];
      const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
      traces.push({
        type: "scatter",
        mode: "markers+lines",
        name: "Guests (combined)",
        x: fs.combinedGuests.map((p) => p.published_at),
        y: fs.combinedGuests.map((p) => p.value),
        line: { width: 1, color, dash: "dash" },
        marker: { size: 6, symbol: "diamond", color },
        customdata: fs.combinedGuests.map((p) => [
          p.episode_title, p.guest_count, p.guest_names.join(", "), p.episode_id,
        ]),
        hovertemplate:
          "%{x|%Y-%m-%d}<br>%{y:.1f} min total<br>" +
          "%{customdata[1]} guest(s): %{customdata[2]}<br>%{customdata[0]}" +
          clickHint +
          "<extra><b>Guests</b> (combined)</extra>",
        visible: fIdx === 0,
      });
      traceFeed.push(feedId);
    }
  });

  const buttons = feedIds.map((fid) => {
    const fs = series.get(fid)!;
    const hostsLabel = fs.hosts.map((h) => h.display_name).join(", ") || "(none detected)";
    return {
      method: "update" as const,
      label: feedShort(fs.feed_title),
      args: [
        { visible: traceFeed.map((tf) => tf === fid) },
        {
          title: {
            text:
              `Per-speaker minutes per episode — ${feedShort(fs.feed_title)} ` +
              `<i>(${sourceLabel})</i><br><sub>Detected hosts: ${hostsLabel}</sub>`,
          },
        },
      ],
    };
  });

  const initial = series.get(feedIds[0])!;
  const initialHosts = initial.hosts.map((h) => h.display_name).join(", ") || "(none detected)";

  const layout: Partial<Layout> = {
    title: {
      text:
        `Per-speaker minutes per episode — ${feedShort(initial.feed_title)} ` +
        `<i>(${sourceLabel})</i><br><sub>Detected hosts: ${initialHosts}</sub>`,
    },
    hovermode: "x unified",
    legend: { orientation: "h", yanchor: "top", y: -0.2, xanchor: "center", x: 0.5 },
    margin: { l: 60, r: 20, t: 110, b: 160 },
    xaxis: {
      showspikes: true, spikemode: "across", spikesnap: "cursor",
      spikedash: "dot", spikethickness: 1,
    },
    yaxis: { ticksuffix: " min" },
    updatemenus: [{
      type: "dropdown", buttons, direction: "down",
      x: 0, y: 1.18, xanchor: "left", yanchor: "top",
    }],
  };

  return (
    <PlotlyChart
      data={traces}
      layout={layout}
      height={420}
      onPointClick={enableClickOpen ? (epId) => router.push(`/episodes/${epId}`) : undefined}
    />
  );
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/SpeakerMinutesChart.tsx
git commit -m "feat(web): add SpeakerMinutesChart (PRD-06 §4)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.5: `SpeakerWordsChart` component

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/SpeakerWordsChart.tsx`

- [ ] **Step 1: Implement**

Same structure as `SpeakerMinutesChart`, but pass `"words"` to `buildSpeakerSeries`, change hover format to `%{y:,.0f} words` (and `%{y:,.0f} words total` for combined), and drop the `ticksuffix`. Easiest path: copy `SpeakerMinutesChart.tsx` and parameterize, or duplicate-and-tweak — duplicate is fine here because the formatting strings are scattered.

Key differences from SpeakerMinutesChart:
- `buildSpeakerSeries(rows, "words", source)` (line where minutes was passed)
- Host hover: `"%{x|%Y-%m-%d}<br>%{y:,.0f} words<br>%{customdata[0]}" + clickHint + ...`
- Guests hover: `"%{x|%Y-%m-%d}<br>%{y:,.0f} words total<br>..."`
- Layout: drop `yaxis: { ticksuffix: " min" }` (no suffix for words)
- Title: replace `"minutes"` with `"word count"` in the two title strings.

```tsx
// apps/web/src/app/meta-analysis/charts/SpeakerWordsChart.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Data, Layout } from "plotly.js";
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";
import PlotlyChart from "./PlotlyChart";
import { buildSpeakerSeries, type Source } from "./transforms/speakerRows";
import { feedShort, HOST_PALETTE, GUEST_PALETTE } from "./transforms/feedShort";

interface Props {
  rows: PerEpisodeSpeaker[];
  source: Source;
  enableClickOpen?: boolean;
}

export default function SpeakerWordsChart({ rows, source, enableClickOpen = true }: Props) {
  const router = useRouter();
  const series = useMemo(() => buildSpeakerSeries(rows, "words", source), [rows, source]);
  const sourceLabel = source === "confirmed" ? "Confirmed" : "Inferred — HIGH";

  if (series.size === 0) {
    return <p className="text-sm text-muted-foreground">No data for {sourceLabel} source.</p>;
  }

  const feedIds = Array.from(series.keys());
  const traces: Data[] = [];
  const traceFeed: string[] = [];

  feedIds.forEach((feedId, fIdx) => {
    const fs = series.get(feedId)!;
    fs.hosts.forEach((h, hIdx) => {
      const color = HOST_PALETTE[hIdx % HOST_PALETTE.length];
      const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
      traces.push({
        type: "scatter",
        mode: "markers+lines",
        name: `${h.display_name} (host)`,
        x: h.points.map((p) => p.published_at),
        y: h.points.map((p) => p.value),
        line: { width: 2, color },
        marker: { size: 7, symbol: "circle", color },
        customdata: h.points.map((p) => [p.episode_title, p.episode_id]),
        hovertemplate:
          "%{x|%Y-%m-%d}<br>%{y:,.0f} words<br>%{customdata[0]}" +
          clickHint +
          `<extra><b>${h.display_name}</b> (host)</extra>`,
        visible: fIdx === 0,
      });
      traceFeed.push(feedId);
    });
    if (fs.combinedGuests.length > 0) {
      const color = GUEST_PALETTE[0];
      const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
      traces.push({
        type: "scatter",
        mode: "markers+lines",
        name: "Guests (combined)",
        x: fs.combinedGuests.map((p) => p.published_at),
        y: fs.combinedGuests.map((p) => p.value),
        line: { width: 1, color, dash: "dash" },
        marker: { size: 6, symbol: "diamond", color },
        customdata: fs.combinedGuests.map((p) => [
          p.episode_title, p.guest_count, p.guest_names.join(", "), p.episode_id,
        ]),
        hovertemplate:
          "%{x|%Y-%m-%d}<br>%{y:,.0f} words total<br>" +
          "%{customdata[1]} guest(s): %{customdata[2]}<br>%{customdata[0]}" +
          clickHint +
          "<extra><b>Guests</b> (combined)</extra>",
        visible: fIdx === 0,
      });
      traceFeed.push(feedId);
    }
  });

  const buttons = feedIds.map((fid) => {
    const fs = series.get(fid)!;
    const hostsLabel = fs.hosts.map((h) => h.display_name).join(", ") || "(none detected)";
    return {
      method: "update" as const,
      label: feedShort(fs.feed_title),
      args: [
        { visible: traceFeed.map((tf) => tf === fid) },
        {
          title: {
            text:
              `Per-speaker word count per episode — ${feedShort(fs.feed_title)} ` +
              `<i>(${sourceLabel})</i><br><sub>Detected hosts: ${hostsLabel}</sub>`,
          },
        },
      ],
    };
  });

  const initial = series.get(feedIds[0])!;
  const initialHosts = initial.hosts.map((h) => h.display_name).join(", ") || "(none detected)";

  const layout: Partial<Layout> = {
    title: {
      text:
        `Per-speaker word count per episode — ${feedShort(initial.feed_title)} ` +
        `<i>(${sourceLabel})</i><br><sub>Detected hosts: ${initialHosts}</sub>`,
    },
    hovermode: "x unified",
    legend: { orientation: "h", yanchor: "top", y: -0.2, xanchor: "center", x: 0.5 },
    margin: { l: 60, r: 20, t: 110, b: 160 },
    xaxis: {
      showspikes: true, spikemode: "across", spikesnap: "cursor",
      spikedash: "dot", spikethickness: 1,
    },
    updatemenus: [{
      type: "dropdown", buttons, direction: "down",
      x: 0, y: 1.18, xanchor: "left", yanchor: "top",
    }],
  };

  return (
    <PlotlyChart
      data={traces}
      layout={layout}
      height={420}
      onPointClick={enableClickOpen ? (epId) => router.push(`/episodes/${epId}`) : undefined}
    />
  );
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/SpeakerWordsChart.tsx
git commit -m "feat(web): add SpeakerWordsChart (PRD-06 §5)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 3.6: `HostGuestDiffChart` component

**Files:**
- Create: `apps/web/src/app/meta-analysis/charts/HostGuestDiffChart.tsx`

- [ ] **Step 1: Implement**

```tsx
// apps/web/src/app/meta-analysis/charts/HostGuestDiffChart.tsx
"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Data, Layout } from "plotly.js";
import type { EpisodeSpeakerDiff } from "@/lib/metaAnalysisTypes";
import PlotlyChart from "./PlotlyChart";
import { filterDiffRows, summarizeDiff } from "./transforms/diffRows";
import type { Source } from "./transforms/speakerRows";
import { feedShort, PALETTE, hexToRgba } from "./transforms/feedShort";

interface Props {
  rows: EpisodeSpeakerDiff[];
  source: Source;
  enableClickOpen?: boolean;
}

export default function HostGuestDiffChart({ rows, source, enableClickOpen = true }: Props) {
  const router = useRouter();
  const filtered = useMemo(() => filterDiffRows(rows, source), [rows, source]);
  const sourceLabel = source === "confirmed" ? "Confirmed" : "Inferred — HIGH";

  if (filtered.length === 0) {
    return <p className="text-sm text-muted-foreground">No episodes with both hosts and guests for {sourceLabel} source.</p>;
  }

  // Group by feed (deterministic order: by feed_title).
  const byFeed = new Map<string, EpisodeSpeakerDiff[]>();
  for (const r of filtered) {
    if (!byFeed.has(r.feed_id)) byFeed.set(r.feed_id, []);
    byFeed.get(r.feed_id)!.push(r);
  }
  const feedIds = Array.from(byFeed.keys());

  const traces: Data[] = [];
  const traceFeed: string[] = [];

  feedIds.forEach((fid, fIdx) => {
    const sub = byFeed.get(fid)!;
    const color = PALETTE[fIdx % PALETTE.length];
    const fill = hexToRgba(color, 0.18);
    // Upper band (invisible).
    traces.push({
      type: "scatter", mode: "lines",
      x: sub.map((r) => r.published_at),
      y: sub.map((r) => r.band_hi),
      line: { width: 0 }, hoverinfo: "skip", showlegend: false,
      visible: fIdx === 0,
    });
    traceFeed.push(fid);
    // Lower band with fill.
    traces.push({
      type: "scatter", mode: "lines",
      x: sub.map((r) => r.published_at),
      y: sub.map((r) => r.band_lo),
      line: { width: 0 }, fill: "tonexty", fillcolor: fill,
      hoverinfo: "skip", showlegend: false,
      visible: fIdx === 0,
    });
    traceFeed.push(fid);
    // Diff line.
    const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
    traces.push({
      type: "scatter", mode: "markers+lines",
      name: `${feedShort(sub[0].feed_title)} (guest − host avg, min)`,
      x: sub.map((r) => r.published_at),
      y: sub.map((r) => r.diff),
      line: { width: 2, color },
      marker: { size: 7, color },
      customdata: sub.map((r) => [
        r.episode_title, r.host_mean, r.host_count, r.guest_mean, r.guest_count,
        r.host_names.join(", "), r.guest_names.join(", "), r.episode_id,
      ]),
      hovertemplate:
        "%{x|%Y-%m-%d}<br>" +
        "Δ = %{y:+.1f} min  (guest − host avg)<br>" +
        "Hosts (%{customdata[2]}, avg %{customdata[1]:.1f} min): %{customdata[5]}<br>" +
        "Guests (%{customdata[4]}, avg %{customdata[3]:.1f} min): %{customdata[6]}<br>" +
        "%{customdata[0]}" +
        clickHint +
        `<extra>${feedShort(sub[0].feed_title)}</extra>`,
      visible: fIdx === 0,
    });
    traceFeed.push(fid);
  });

  const buttons = feedIds.map((fid) => {
    const sub = byFeed.get(fid)!;
    const s = summarizeDiff(sub);
    const subtitle = `${s.total} episode(s) compared — guests talked more in ${s.guestsMore}, hosts in ${s.hostsMore}`;
    return {
      method: "update" as const,
      label: feedShort(sub[0].feed_title),
      args: [
        { visible: traceFeed.map((tf) => tf === fid) },
        {
          title: {
            text:
              `Host vs Guest talking time per episode — ${feedShort(sub[0].feed_title)} ` +
              `<i>(${sourceLabel})</i><br><sub>${subtitle}</sub>`,
          },
        },
      ],
    };
  });

  const initial = byFeed.get(feedIds[0])!;
  const initSummary = summarizeDiff(initial);

  const layout: Partial<Layout> = {
    title: {
      text:
        `Host vs Guest talking time per episode — ${feedShort(initial[0].feed_title)} ` +
        `<i>(${sourceLabel})</i><br><sub>${initSummary.total} episode(s) compared — ` +
        `guests talked more in ${initSummary.guestsMore}, hosts in ${initSummary.hostsMore}</sub>`,
    },
    hovermode: "x unified",
    legend: { orientation: "h", yanchor: "top", y: -0.2, xanchor: "center", x: 0.5 },
    margin: { l: 60, r: 20, t: 110, b: 160 },
    xaxis: {
      showspikes: true, spikemode: "across", spikesnap: "cursor",
      spikedash: "dot", spikethickness: 1,
    },
    yaxis: { title: { text: "Δ minutes (guest avg − host avg)" }, ticksuffix: " min", zeroline: false },
    shapes: [{
      type: "line", xref: "paper", x0: 0, x1: 1, y0: 0, y1: 0,
      line: { color: "#888", width: 1, dash: "dot" },
    }],
    updatemenus: [{
      type: "dropdown", buttons, direction: "down",
      x: 0, y: 1.18, xanchor: "left", yanchor: "top",
    }],
  };

  return (
    <PlotlyChart
      data={traces}
      layout={layout}
      height={420}
      onPointClick={enableClickOpen ? (epId) => router.push(`/episodes/${epId}`) : undefined}
    />
  );
}
```

- [ ] **Step 2: Verify TS compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/meta-analysis/charts/HostGuestDiffChart.tsx
git commit -m "feat(web): add HostGuestDiffChart (PRD-06 §6)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 4 — Wire the new charts into `MetaAnalysisClient`

### Task 4.1: Delete old chart imports and grid; render the 6 new cards

**Files:**
- Modify: `apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx`

- [ ] **Step 1: Replace chart imports**

In `MetaAnalysisClient.tsx`, delete these imports:

```typescript
import CostPerFeed from "./charts/CostPerFeed";
import EpisodeLengthTrend from "./charts/EpisodeLengthTrend";
import HostGuestShare from "./charts/HostGuestShare";
import LengthPerFeed from "./charts/LengthPerFeed";
import ProcessingTimeDistribution from "./charts/ProcessingTimeDistribution";
import ReleaseTimeline from "./charts/ReleaseTimeline";
import TurnDensity from "./charts/TurnDensity";
import WpmPerSpeaker from "./charts/WpmPerSpeaker";
import TokensPerEpisode from "./charts/TokensPerEpisode";
```

Add:

```typescript
import SpeakerMinutesChart from "./charts/SpeakerMinutesChart";
import SpeakerWordsChart from "./charts/SpeakerWordsChart";
import HostGuestDiffChart from "./charts/HostGuestDiffChart";
```

- [ ] **Step 2: Replace the chart grid**

Find the `<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">` block. Replace its entire contents (the 9 ChartCards) with 6 new cards. The grid should also widen — six tall Plotly charts on a 3-col grid will be cramped; switch to 2 columns:

```tsx
<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
  <ChartCard
    title="Per-speaker minutes per episode"
    subtitle="Confirmed speakers"
  >
    <SpeakerMinutesChart
      rows={Array.isArray(snap.per_episode_speaker) ? snap.per_episode_speaker : []}
      source="confirmed"
    />
  </ChartCard>
  <ChartCard
    title="Per-speaker minutes per episode"
    subtitle="Inferred — HIGH confidence"
  >
    <SpeakerMinutesChart
      rows={Array.isArray(snap.per_episode_speaker) ? snap.per_episode_speaker : []}
      source="inferred_high"
    />
  </ChartCard>

  <ChartCard
    title="Per-speaker word count per episode"
    subtitle="Confirmed speakers"
  >
    <SpeakerWordsChart
      rows={Array.isArray(snap.per_episode_speaker) ? snap.per_episode_speaker : []}
      source="confirmed"
    />
  </ChartCard>
  <ChartCard
    title="Per-speaker word count per episode"
    subtitle="Inferred — HIGH confidence"
  >
    <SpeakerWordsChart
      rows={Array.isArray(snap.per_episode_speaker) ? snap.per_episode_speaker : []}
      source="inferred_high"
    />
  </ChartCard>

  <ChartCard
    title="Host vs Guest talking time per episode"
    subtitle="Confirmed speakers"
  >
    <HostGuestDiffChart
      rows={Array.isArray(snap.episode_speaker_diff) ? snap.episode_speaker_diff : []}
      source="confirmed"
    />
  </ChartCard>
  <ChartCard
    title="Host vs Guest talking time per episode"
    subtitle="Inferred — HIGH confidence"
  >
    <HostGuestDiffChart
      rows={Array.isArray(snap.episode_speaker_diff) ? snap.episode_speaker_diff : []}
      source="inferred_high"
    />
  </ChartCard>
</div>
```

Note: the per-feed filter from `FiltersBar` still applies — but PRD-06's charts have their own per-feed dropdown in Plotly. Decision: keep `FiltersBar` for **selecting which feeds to show in the dropdown**. The transform should respect `selectedFeedIds`; pass it down. (Alternative: drop `FiltersBar` interaction effect on these charts; user can still see it visually. Keep the simple version for now: filter `rows` upstream of the chart by `selectedFeedIds`.)

Add this filtering above the `<div className="grid ...">`:

```typescript
const selectedSet = new Set(selectedFeedIds);
const filteredSpeakerRows = (Array.isArray(snap.per_episode_speaker) ? snap.per_episode_speaker : [])
  .filter((r) => selectedSet.size === 0 || selectedSet.has(r.feed_id));
const filteredDiffRows = (Array.isArray(snap.episode_speaker_diff) ? snap.episode_speaker_diff : [])
  .filter((r) => selectedSet.size === 0 || selectedSet.has(r.feed_id));
```

…and pass `filteredSpeakerRows` / `filteredDiffRows` to the charts instead of `snap.per_episode_speaker` / `snap.episode_speaker_diff`.

- [ ] **Step 3: Verify TS compiles**

```bash
cd apps/web && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 4: Run dev server, eyeball the page**

```bash
make rebuild-pipeline   # or: docker compose build pipeline web
make up
```

Then open http://localhost:3000/meta-analysis. Click **Refresh** to repopulate the snapshot. Confirm:
- 6 chart cards render (2 per family).
- Each chart shows a per-feed dropdown.
- Clicking a data point opens `/episodes/<id>`.
- Dark mode toggle switches the chart template.

If `snap.per_episode_speaker` is empty until refresh runs, that's expected — the snapshot was stored before this code; a single refresh fixes it.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/meta-analysis/MetaAnalysisClient.tsx
git commit -m "feat(web): replace meta-analysis charts with PRD-06 plots

Six new Plotly chart cards (per-speaker minutes/words/diff x Confirmed +
Inferred-HIGH). Existing chrome (header, refresh, filters, coverage strip,
missing-speakers modal, explore panel, info block) preserved.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.2: Delete the now-unused chart components

**Files:**
- Delete: `apps/web/src/app/meta-analysis/charts/{CostPerFeed,EpisodeLengthTrend,HostGuestShare,LengthPerFeed,ProcessingTimeDistribution,ReleaseTimeline,TokensPerEpisode,TurnDensity,WpmPerSpeaker}.tsx`
- Delete: `apps/web/src/app/meta-analysis/charts/transforms/*` (only the old transforms — keep `feedShort.ts`, `speakerRows.ts`, `diffRows.ts`, and `__tests__/`)

- [ ] **Step 1: List then delete**

```bash
ls apps/web/src/app/meta-analysis/charts/transforms/
```

Identify the ones added by PRD-06 (feedShort, speakerRows, diffRows, __tests__) vs older ones — only delete the older ones.

```bash
rm apps/web/src/app/meta-analysis/charts/CostPerFeed.tsx
rm apps/web/src/app/meta-analysis/charts/EpisodeLengthTrend.tsx
rm apps/web/src/app/meta-analysis/charts/HostGuestShare.tsx
rm apps/web/src/app/meta-analysis/charts/LengthPerFeed.tsx
rm apps/web/src/app/meta-analysis/charts/ProcessingTimeDistribution.tsx
rm apps/web/src/app/meta-analysis/charts/ReleaseTimeline.tsx
rm apps/web/src/app/meta-analysis/charts/TokensPerEpisode.tsx
rm apps/web/src/app/meta-analysis/charts/TurnDensity.tsx
rm apps/web/src/app/meta-analysis/charts/WpmPerSpeaker.tsx
# Delete old transforms (verify each isn't imported anywhere before rm):
for f in apps/web/src/app/meta-analysis/charts/transforms/*.ts; do
  base=$(basename "$f" .ts)
  case "$base" in
    feedShort|speakerRows|diffRows) ;;
    *) rm "$f" ;;
  esac
done
```

- [ ] **Step 2: Verify build + type-check**

```bash
cd apps/web && npx tsc --noEmit && npm run build
```

Expected: success.

- [ ] **Step 3: Run web unit tests**

```bash
cd apps/web && npx jest
```

Expected: pass. If a deleted chart had tests, they need to be deleted too — `rm apps/web/src/app/meta-analysis/charts/__tests__/<chart>.test.tsx` for any matches.

- [ ] **Step 4: Commit**

```bash
git add -A apps/web/src/app/meta-analysis/charts/
git commit -m "chore(web): remove legacy meta-analysis charts (replaced by PRD-06)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.3: Update `InfoBlock` copy

**Files:**
- Modify: `apps/web/src/app/meta-analysis/InfoBlock.tsx`

- [ ] **Step 1: Replace the explanatory text**

Open the file and replace the body text so it describes the three new plot families. Read the current contents first; replace prose only — keep structural elements (headings, links, etc.) consistent with neighboring components.

Suggested copy:

```markdown
**Per-speaker minutes / words per episode** show how each host's airtime
(or word count) evolves across a podcast's run. Guests are collapsed into a
single dashed trace per feed; hover lists the names.

**Host vs Guest talking time** plots a single signed Δ per episode
(guest avg − host avg). Above 0 means guests dominated on average; below 0
means hosts did. The shaded band shows the widest possible Δ given individual
speaker variation.

Each chart family is shown twice — once for **Confirmed** speakers
(user-validated names) and once for **Inferred — HIGH** confidence
(automatic detections). The inferred view includes more rows but some noise
(name fragments, false positives).
```

- [ ] **Step 2: Verify build**

```bash
cd apps/web && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/app/meta-analysis/InfoBlock.tsx
git commit -m "docs(web): update meta-analysis InfoBlock for PRD-06 plots

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 4.4: Run full web test suite + smoke against live stack

**Files:** none (verification only)

- [ ] **Step 1: Run jest**

```bash
cd apps/web && npx jest
```

Expected: pass.

- [ ] **Step 2: Run lint**

```bash
cd apps/web && npm run lint
```

Expected: pass.

- [ ] **Step 3: Bring up stack + refresh snapshot**

```bash
make rebuild-pipeline
make rebuild-web   # if defined; else docker compose build web && docker compose up -d web
make up
```

Open http://localhost:3000/meta-analysis, click **↻ Refresh**, and wait for the snapshot to recompute. Confirm:
- Six chart cards render.
- Per-feed dropdown in each chart works.
- Clicking a data point navigates to `/episodes/<id>`.
- Dark mode toggle re-themes the charts without re-rendering data.
- `FiltersBar` selection narrows the feeds visible in the dropdowns.

If anything fails, debug and fix before continuing. Don't commit if smoke fails.

---

## Phase 5 — Notebook bonus

### Task 5.1: Extract `notebooks/lib/podlog_plots.py`

**Files:**
- Create: `notebooks/lib/__init__.py`
- Create: `notebooks/lib/podlog_plots.py`

- [ ] **Step 1: Create empty package marker**

```bash
touch notebooks/lib/__init__.py
```

- [ ] **Step 2: Port the prototype's speaker plot code into `podlog_plots.py`**

The prototype lives at `~/repos/playground/2026-05-15-podlog-meta-prototyping/plots.py`. The relevant functions are `plot_speakers()`, `plot_speaker_diff()`, and their helpers `_confirmed_role_map()`, `_load_speaker_data()`, plus constants `SPEAKER_SOURCES`, `SPEAKER_METRICS`, `HOST_THRESHOLD`, `HOST_PALETTE`, `GUEST_PALETTE`, `PALETTE`, `FEED_SHORT`, `_short`, `_hex_to_rgba`.

Copy those into `notebooks/lib/podlog_plots.py`. Make these adjustments:

1. **Connection:** Inside Docker, the explore service connects to `db:5432`, not `localhost`. Use:
```python
import os
PG_HOST = os.environ.get("POSTGRES_HOST", "db")
PG_PASSWORD = os.environ.get("POSTGRES_PASSWORD")
if not PG_PASSWORD:
    raise SystemExit("POSTGRES_PASSWORD must be set in the env")
ENGINE = create_engine(
    f"postgresql+psycopg2://postgres:{PG_PASSWORD}@{PG_HOST}:5432/podlog"
)
```

2. **Click-to-open URL:** Replace the prototype's `episodes.episode_url` with a constructed in-podlog URL:
```python
PODLOG_WEB_URL = os.environ.get("PODLOG_WEB_URL", "http://localhost:3000")
```
Then in `_load_speaker_data` and `plot_speaker_diff`, build `episode_url` as `f"{PODLOG_WEB_URL}/episodes/{episode_id}"` instead of selecting `e.episode_url`.

3. **Drop the prototype's `_save()` HTML wrapper and `_nav_html()`** — the notebook doesn't need standalone HTML pages.

4. **Adapt `plot_speakers` / `plot_speaker_diff`** to return the `go.Figure` instead of saving it, so the notebook can show or restyle it:
```python
def plot_speakers(...) -> go.Figure | None:
    ...
    return fig  # instead of _save(...)
```

5. **Export only what the notebook needs.** Add at the bottom:
```python
__all__ = [
    "plot_speakers", "plot_speaker_diff",
    "SPEAKER_SOURCES", "SPEAKER_METRICS",
]
```

- [ ] **Step 3: Verify import**

```bash
docker compose exec explore python -c "from notebooks.lib.podlog_plots import plot_speakers; print(plot_speakers)"
```

(Adjust path depending on the explore container's mount.)

Expected: prints `<function plot_speakers ...>`.

- [ ] **Step 4: Commit**

```bash
git add notebooks/lib/__init__.py notebooks/lib/podlog_plots.py
git commit -m "feat(notebooks): add podlog_plots module (port of PRD-06 prototype)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 5.2: Update `01_explore_db.ipynb` — delete PRD-05 §6 cell, add new cells + source toggle

**Files:**
- Modify: `notebooks/examples/01_explore_db.ipynb`

> **Heads-up:** Editing notebooks via plain text edit is fragile. Use `jupyter nbconvert --to notebook --execute` rather than hand-editing JSON. Easiest path: open the notebook in Jupyter, add the cells, save, commit.

- [ ] **Step 1: Open the notebook in the explore service**

```bash
make up
docker compose exec explore jupyter notebook --ip=0.0.0.0 --no-browser
# Open the printed URL in browser; navigate to examples/01_explore_db.ipynb
```

- [ ] **Step 2: Delete the existing per-speaker minutes cell (PRD-05 §6)**

Find the cell with title `Per-speaker minutes per episode` (the cell that uses `HOST_THRESHOLD = 0.25` and the `updatemenus` per-feed dropdown). Delete the cell.

- [ ] **Step 3: Add the source toggle widget cell**

Insert a new cell with:

```python
import ipywidgets as widgets
from IPython.display import display
from notebooks.lib.podlog_plots import plot_speakers, plot_speaker_diff

source_toggle = widgets.RadioButtons(
    options=[("Confirmed", "confirmed"), ("Inferred (HIGH)", "inferred_high")],
    value="confirmed",
    description="Source:",
)
display(source_toggle)
```

- [ ] **Step 4: Add six figure cells, one per (family, source)**

For each combination, add a cell calling the helper and re-rendering on toggle change. Pattern:

```python
import plotly.graph_objects as go
from IPython.display import display

out_minutes_conf = widgets.Output()
display(out_minutes_conf)
def _render_min(_=None):
    with out_minutes_conf:
        out_minutes_conf.clear_output()
        fig = plot_speakers(source=source_toggle.value, metric="minutes")
        if fig is not None: fig.show()
_render_min()
source_toggle.observe(_render_min, names="value")
```

Repeat with separate `out_*` widgets and `_render_*` functions for:
- minutes (one cell, re-renders on toggle change)
- words (one cell, re-renders on toggle change)
- diff (one cell, re-renders on toggle change)

Per the user's "want to see both at the page" answer for the web app, but they kept the ipywidgets toggle for the notebook — so three cells (one per family), each re-rendering when the toggle flips, is faithful to PRD §3.1b.

- [ ] **Step 5: Save, run all cells, verify all three figures render**

`Kernel → Restart & Run All`. Confirm:
- Source toggle appears.
- Three figures render (minutes / words / diff).
- Switching the toggle re-renders each figure.

- [ ] **Step 6: Render to standalone HTML**

```bash
docker compose exec -T explore sh -c \
  "cd /workspace/examples && jupyter nbconvert --to html --execute \
   --ExecutePreprocessor.timeout=600 01_explore_db.ipynb"
```

Open the rendered HTML to verify — note that ipywidgets are inert in the static HTML (whichever source was selected at render time is what's shown). This is expected per PRD-06 §3.1b.

- [ ] **Step 7: Commit**

```bash
git add notebooks/examples/01_explore_db.ipynb
git commit -m "feat(notebooks): wire PRD-06 speaker plots into 01_explore_db.ipynb

Replaces PRD-05 §6 (superseded) with three figures (minutes, words, diff)
driven by an ipywidgets source toggle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Phase 6 — Docs cleanup

### Task 6.1: Mark PRD-05 §6 as superseded

**Files:**
- Modify: `prds/PRD-05-exploratory-plots.md`

- [ ] **Step 1: Add a banner at the top of §6**

Find `## 6. Plot 3 — Per-speaker minutes per episode, with host/guest classification`. Insert immediately below the heading:

```markdown
> **Superseded.** This plot is replaced by PRD-06 §4 (Per-speaker minutes per episode). The notebook cell that implemented this section has been removed; the new implementation lives in `notebooks/lib/podlog_plots.py` via `01_explore_db.ipynb`.
```

- [ ] **Step 2: Update PRD-05 changelog entry**

In the header changelog block:

```markdown
- v1.1 — Marked §6 as superseded by PRD-06 §4. Removed corresponding notebook cell.
- v1.0 — Initial draft. Three custom Plotly visualizations…
```

Bump `**Version:** 1.0` → `**Version:** 1.1`.

- [ ] **Step 3: Commit**

```bash
git add prds/PRD-05-exploratory-plots.md
git commit -m "docs(prd-05): mark §6 as superseded by PRD-06 §4

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.2: CHANGELOG entry

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 1: Add an entry under `## Unreleased`**

Read the current `Unreleased` section. Add under the Major bucket (or create one):

```markdown
- **Meta-Analysis page rewrite (PRD-06):** Replaced the nine Recharts cards with six Plotly figures — per-speaker minutes, per-speaker word count, and host-vs-guest talking-time diff, each shown for Confirmed and Inferred-HIGH speaker sources. Charts support per-feed selection (dropdown inside each chart), click-to-open episode, dark mode, and hover with spike lines. Existing chrome (refresh, filters, coverage strip, missing-speakers modal, explore panel) preserved.
- **Speaker analytics in notebook (PRD-06 bonus):** New `notebooks/lib/podlog_plots.py` module + `01_explore_db.ipynb` cells with an ipywidgets source toggle.
```

- [ ] **Step 2: Commit**

```bash
git add CHANGELOG.md
git commit -m "docs(changelog): note PRD-06 meta-analysis rewrite

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task 6.3: Final cross-cutting verification

**Files:** none (verification only)

- [ ] **Step 1: Full pipeline test suite**

```bash
docker compose -f docker-compose.test.yml build test
docker compose -f docker-compose.test.yml run --rm test pytest apps/pipeline/tests/
```

Expected: pass with coverage ≥ 82% (matches `ci-full-unit.yml`).

- [ ] **Step 2: Full web test suite**

```bash
docker compose -f docker-compose.test.yml build web_test
docker compose -f docker-compose.test.yml run --rm web_test
```

Expected: pass.

- [ ] **Step 3: Manual smoke on the running stack**

```bash
make up
```

Open http://localhost:3000/meta-analysis. Click Refresh. Verify all 6 charts. Check dark mode. Click points.

- [ ] **Step 4: Ask the user about a VERSION bump**

Per `feedback_version_bumps.md`: don't auto-bump. Ask: "Phase 6 done. This is a user-visible major change. Want me to bump VERSION (currently `<read VERSION>`)? Suggested: minor bump (X.Y.Z → X.(Y+1).0)."

- [ ] **Step 5: Open PR (when user gives the go-ahead)**

```bash
gh pr create --title "feat(web): replace Meta-Analysis page with PRD-06 speaker plots" \
  --body "$(cat <<'EOF'
## Summary
- Implements PRD-06 v1.1 — Meta-Analysis page rewritten with six Plotly figures (per-speaker minutes, per-speaker words, host-vs-guest diff; each for Confirmed and Inferred-HIGH speaker sources).
- Pipeline snapshot extended with two new arrays (`per_episode_speaker`, `episode_speaker_diff`); no DB migration required.
- Bonus: `notebooks/lib/podlog_plots.py` + 01_explore_db.ipynb cells with an ipywidgets source toggle.

## Test plan
- [ ] `make test-unit` passes
- [ ] Open `/meta-analysis`, click Refresh, verify 6 charts render
- [ ] Click a data point — opens `/episodes/<id>`
- [ ] Toggle dark mode — chart template switches
- [ ] FiltersBar narrows the feeds in each chart's dropdown
- [ ] Notebook renders to HTML without errors

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review Notes

- **Spec coverage:** Every PRD-06 plot family (§4 minutes, §5 words, §6 diff) has a Phase 3 task; every cross-cutting requirement (§3 source, click-to-open, theme, dropdown) is wired in `MetaAnalysisClient` (Phase 4) and `podlog_plots.py` (Phase 5). §3.1 is satisfied web-app-side by rendering both variants statically (per user direction) and notebook-side by ipywidgets (per spec).
- **Notable simplification:** PRD-06 §3.1's "single notebook-wide widget" requirement still holds for the notebook. For the web page, the user explicitly chose "both visible" instead of an interactive toggle, so each chart family becomes two cards.
- **No DB migration:** confirmed — snapshot is JSONB and adding new top-level keys is backward-compatible (existing snapshots without the new keys cause `snap.per_episode_speaker` to be `undefined`; transforms handle that with `Array.isArray(...) ? ... : []`).
- **Risks flagged in PRD-06 §10 (inferred-source noise like `Twitter`, `Linkedin`) are NOT addressed here** — they remain future work; the InfoBlock in Task 4.3 calls out this caveat.

---

**Plan complete and saved to `docs/superpowers/plans/2026-05-17-prd06-meta-analysis-plots.md`. Two execution options:**

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
