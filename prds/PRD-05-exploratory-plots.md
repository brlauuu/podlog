# PRD-05: Exploratory Plots — `notebooks/examples/01_explore_db.ipynb`

**Project:** Podlog — Self-hosted Podcast Transcription & Search
**Document:** PRD-05 — Exploratory Plots (cross-feed analytics in the explore notebook)
**Version:** 1.1
**Status:** Active
**Depends on:** PRD-01 v1.1 (data model), PRD-04 v1.8 (host/guest inference notion of "recurring host")

**Changelog:**
- v1.1 — Marked §6 as superseded by PRD-06 §4 (now implemented in the Meta-Analysis web page + notebook bonus).
- v1.0 — Initial draft. Documents three custom Plotly visualizations added to `notebooks/examples/01_explore_db.ipynb` for ad-hoc exploration of the Podlog DB: (a) episode duration over time, (b) episode word count over time, (c) per-speaker minutes per episode with host vs. guest classification. Branch `698-speaker-roles`.

---

## 1. Problem Statement

The `explore` Docker service mounts a Jupyter kernel against the Podlog production-shaped DB (per Issue #607). The starter notebook (`01_explore_db.ipynb`) demonstrates connection and a few sample queries, but does not include any cross-feed analytical plots that are useful for understanding how podcast content evolves over time or how speaking time is distributed between hosts and guests.

This PRD specifies three reusable plot cells that should live at the bottom of `01_explore_db.ipynb`, between the existing "## 4. Plot something" section (bar chart of episodes per feed) and "## What next" closing markdown. Each plot is self-contained and idempotent.

---

## 2. Goals & Non-Goals

### Goals
- Provide reproducible code for three cross-feed plots that survive branch switches by being checked into the example notebook.
- Use only data already present in the database — no new migrations, columns, or pipeline stages.
- Render fully interactive Plotly figures that embed `plotly.js` inline so the HTML rendered by `jupyter nbconvert` is self-contained (works offline).
- Keep podcast titles readable in legends via a small mapping table (some feed titles like "The Twenty Minute VC..." overflow the figure).

### Non-Goals
- These plots are not part of the web app's user-facing UI. They live in the notebook for ad-hoc exploration.
- Not all confirmed-speaker data is available for every podcast; gaps are expected and rendered as missing points (no imputation).

---

## 3. Shared Conventions

All three plot cells live below cell `cell-10` (the bar chart) and share the following conventions.

### 3.1 Imports & renderer
The first plot cell sets:
```python
import plotly.io as pio
import plotly.graph_objects as go
from plotly.colors import qualitative

pio.renderers.default = "notebook"
```
The `notebook` renderer embeds `plotly.js` directly into the cell output (not via CDN), so the HTML produced by `nbconvert` is self-contained and the figures remain interactive even when opened from disk without a network connection. Subsequent cells reuse the same `go` / `qualitative` / `pio` imports.

### 3.2 Podcast title shortening
A small dictionary collapses long RSS titles to legend-friendly labels:
```python
feed_short = {
    "Lenny's Podcast: Product | Career | Growth": "Lenny's Podcast",
    "The Jacob Shapiro Podcast": "Jacob Shapiro",
    "Dwarkesh Podcast": "Dwarkesh",
    "Geopolitical Cousins": "Geopolitical Cousins",
    "Agelast podcast": "Agelast",
    "The Twenty Minute VC (20VC): Venture Capital | Startup Funding | The Pitch": "20VC",
}
```
Unknown titles pass through unchanged. Defined once in plot 1 and reused by plots 2 & 3.

### 3.3 Color palettes
- `palette = qualitative.Plotly` — per-feed series in plots 1 & 2.
- `HOST_PALETTE = qualitative.D3` — bold colors for host lines in plot 3.
- `GUEST_PALETTE = qualitative.Pastel` — soft colors for guest lines in plot 3.

### 3.4 Hex → rgba helper
A small helper converts the palette's hex colors to translucent rgba for shaded confidence bands:
```python
def _hex_to_rgba(hex_color: str, alpha: float) -> str:
    h = hex_color.lstrip("#")
    r, g, b = int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)
    return f"rgba({r},{g},{b},{alpha})"
```

### 3.5 Time handling
`published_at` is `timestamp with time zone` in the DB. All plots strip tz via `.dt.tz_localize(None)` after `pd.to_datetime(...)` to suppress pandas warnings and produce naive timestamps suitable for `to_period("M")` monthly bucketing.

### 3.6 Legend placement
Legends are placed below the plot, horizontal, centered:
```python
legend=dict(orientation="h", yanchor="top", y=-0.2, xanchor="center", x=0.5)
```
`margin=dict(b=120)` (160 for plot 3) leaves room for the legend.

---

## 4. Plot 1 — Episode duration over time, per podcast

### 4.1 Intent
Show how episode length per podcast has evolved over time, with uncertainty around the monthly mean.

### 4.2 Data source & query
```sql
SELECT f.title AS feed, e.published_at, e.duration_secs / 3600.0 AS hours
FROM episodes e
JOIN feeds f ON f.id = e.feed_id
WHERE e.published_at IS NOT NULL AND e.duration_secs IS NOT NULL
```

### 4.3 Aggregation
- Apply `feed_short` mapping to titles.
- Bucket to first-of-month timestamps via `pd.to_datetime(...).dt.tz_localize(None).dt.to_period("M").dt.to_timestamp()`.
- Group by `(feed, month)` and aggregate `mean`, `sem`, `std`, `count` on `hours`.
- Compute `lo = mean - sem`, `hi = mean + sem`. Fill NaN sem/std with 0 (single-episode months).

### 4.4 Visual encoding
Per feed, three `go.Scatter` traces:
1. Invisible upper-band line at `hi` (`line.width=0`, `hoverinfo="skip"`, `showlegend=False`).
2. Invisible lower-band line at `lo` with `fill="tonexty"` and translucent fillcolor (alpha 0.18) — fills the SEM band against the previous trace.
3. Solid mean line, width 2, in palette color. The legend entry uses the (shortened) feed name.

All three traces share a `legendgroup=feed` so clicking the legend toggles the full set.

### 4.5 Hover (mean line)
`customdata = [[std, count], ...]`; template:
```
{month|%Y-%m}
Mean: {mean:.2f} h ± {std:.2f} h (std)
Episodes: {count}
```
The tooltip name (in `<extra>`) is the shortened feed name.

### 4.6 Layout
- Title: `Episode duration over time, per podcast (monthly mean ± SEM)`
- Y-axis ticks suffixed with " h" (`fig.update_yaxes(ticksuffix=" h")`)
- `hovermode="x unified"` so all feeds line up on hover.

---

## 5. Plot 2 — Episode word count over time, per podcast

### 5.1 Intent
Show whether episodes have gotten more (or less) verbose over time — content size, independent of duration.

### 5.2 Data source & query
Word count is computed from `segments.text` (raw transcription text) per episode. The segments table is the most direct measure of spoken content. Tokens / chunks were considered (the chunks table exists for retrieval) but words are language-agnostic and easier to interpret.

```sql
SELECT
    f.title AS feed,
    e.published_at,
    SUM(array_length(regexp_split_to_array(trim(s.text), '\s+'), 1)) AS word_count
FROM episodes e
JOIN feeds f ON f.id = e.feed_id
JOIN segments s ON s.episode_id = e.id
WHERE e.published_at IS NOT NULL AND s.text IS NOT NULL AND length(trim(s.text)) > 0
GROUP BY f.title, e.id, e.published_at
```

### 5.3 Aggregation & visual encoding
Identical to Plot 1 (monthly mean ± SEM band per feed), with `word_count` replacing `hours`.

### 5.4 Hover
```
{month|%Y-%m}
Mean: {mean:,.0f} words ± {std:,.0f} (std)
Episodes: {count}
```

### 5.5 Layout
- Title: `Episode word count over time, per podcast (monthly mean ± SEM)`
- Y-axis: "Words per episode" (no suffix).
- Same legend placement and `hovermode="x unified"`.

---

## 6. Plot 3 — Per-speaker minutes per episode, with host/guest classification

> **Superseded.** This plot is replaced by **PRD-06 §4** (Per-speaker minutes per episode) and is now implemented in the Meta-Analysis web page (`apps/web/src/app/meta-analysis/`) and the notebook via `notebooks/lib/podlog_plots.py`. The notes below are kept for historical reference; do not extend this section — extend PRD-06 instead.

### 6.1 Intent
For each podcast, show one line per confirmed speaker giving their per-episode speaking time in minutes. Distinguish recurring hosts from one-off guests visually. Allow the viewer to switch between podcasts via dropdown buttons (one panel per podcast was too crowded; tabs are cleaner).

### 6.2 Host classification heuristic
```python
HOST_THRESHOLD = 0.25
```
A confirmed speaker is a **host** of a feed if they appear in ≥ `HOST_THRESHOLD` (25%) of that feed's episodes-with-confirmed-speakers. Otherwise they are a **guest**. This is the simplest signal that doesn't require additional tables — consistent in spirit with PRD-04's recurring-host rule but computed locally over confirmed labels only (no inference, no caches).

The threshold is conservative enough to catch co-hosts (multi-host shows) and lax enough that a speaker appearing in only 1 of 100 episodes is not mistakenly flagged as a host.

### 6.3 Data source & query
Only `speaker_names` rows with `confirmed_by_user = TRUE` are included — that's the user-validated ground truth.

```sql
SELECT
    f.title AS feed,
    e.id AS episode_id,
    e.title AS episode_title,
    e.published_at,
    sn.display_name,
    SUM(s.end_time - s.start_time) / 60.0 AS minutes
FROM segments s
JOIN episodes e ON e.id = s.episode_id
JOIN feeds f ON f.id = e.feed_id
JOIN speaker_names sn
    ON sn.episode_id = s.episode_id
    AND sn.speaker_label = s.speaker_label
    AND sn.confirmed_by_user = TRUE
WHERE e.published_at IS NOT NULL
GROUP BY f.title, e.id, e.title, e.published_at, sn.display_name
```

### 6.4 Visual encoding
For each feed and each confirmed speaker, one `go.Scatter` trace with `mode="markers+lines"`:

- **Hosts**: `HOST_PALETTE` color, line width 2, circle markers size 7, solid line.
- **Guests**: `GUEST_PALETTE` color, line width 1, diamond markers size 6, `dash="dash"`.

Legend names are `"{display_name} (host)"` or `"{display_name} (guest)"`. Within each podcast, hosts are listed first (by total minutes desc), then guests (by total minutes desc).

### 6.5 Tab switching via `updatemenus`
All traces for all feeds are in a single `go.Figure`. A parallel array `trace_feed: list[str]` records which feed each trace belongs to. Initial visibility is `True` only for traces in `feeds_in_data[0]`.

Buttons are built with `method="update"` and toggle two things:
1. `visible` — boolean list of length `len(fig.data)` selecting only this feed's traces.
2. `title` — switches to `"Per-speaker minutes per episode — {feed}<br><sub>Detected hosts: {hosts_label}</sub>"`.

Buttons are placed at `(x=0.0, y=1.18)` above the plot area, direction `"right"`.

### 6.6 Hover
```
{published_at|%Y-%m-%d}
{minutes:.1f} min
{episode_title}
```
The `<extra>` block bolds the speaker's display name and labels their role (host / guest).

### 6.7 Layout
- Title shows the current feed and the list of detected hosts as a subtitle.
- Y-axis suffix " min".
- `margin=dict(b=160, t=110)` to fit both legend (below) and buttons (above).
- `hovermode="closest"` — per-point hover is more useful than unified x for this plot.

---

## 7. Operational Notes

### 7.1 Rendering to standalone HTML
```bash
docker compose exec -T explore sh -c \
  "cd /workspace/examples && jupyter nbconvert --to html --execute \
   --ExecutePreprocessor.timeout=600 01_explore_db.ipynb"
```
Produces `notebooks/examples/01_explore_db.html` (~9 MB; the size is from inlined `plotly.js`). Open it in a browser to interact with the plots offline.

### 7.2 Gitignored output
`notebooks/examples/*.html` is gitignored (only `*.ipynb` files in `examples/` are checked in). Branch switches will remove the rendered HTML — re-run nbconvert after switching.

### 7.3 Notebook-vs-IDE editing conflict
Editing the `.ipynb` from Claude Code while it is also open in an IDE that auto-saves can clobber Claude's edits. When iterating on notebook cells, close the `.ipynb` in the IDE and view the rendered `.html` instead.

### 7.4 Data freshness
All three plots query the live `explore`-mounted DB. Re-run nbconvert after any pipeline run to refresh.

---

## 8. Future Extensions (out of scope for v1.0)

- Token counts (tiktoken) as an alternative to whitespace word counts in Plot 2 — would be more comparable to LLM context budgets.
- Cumulative host-vs-guest minutes per podcast (stacked area).
- Speaker-talk-time as a fraction of episode duration (normalized y-axis) for Plot 3.
- Make the host threshold per-feed configurable via a widget instead of a global constant.
- Once PRD-04's host inference is mature, swap the local 25%-of-episodes heuristic for the recurring-host signal already computed by the pipeline.
