# PRD-06: Speaker Analytics Plots — `notebooks/examples/01_explore_db.ipynb`

**Project:** Podlog — Self-hosted Podcast Transcription & Search
**Document:** PRD-06 — Speaker analytics plots (per-speaker minutes, per-speaker words, host-vs-guest diff)
**Version:** 1.1
**Status:** Active
**Depends on:** PRD-01 v1.1 (data model), PRD-04 v1.8 (host/guest inference, `speaker_names.role` + `confidence`), PRD-05 v1.0 (explore-notebook plot framework — Shared Conventions §3 are inherited)

**Changelog:**
- v1.1 — Realignment: PRD reframed as a **web-page rewrite** (Meta-Analysis page) with the notebook as a bonus. Web app shows both Confirmed + Inferred-HIGH variants side by side (no toggle); notebook keeps the ipywidgets toggle. Click-to-open is in-app via Next.js router on the web page, and via `PODLOG_WEB_URL` env in the notebook.
- v1.0 — Initial draft. Specifies three new plot families (six rendered cells), each with a Confirmed-source variant and an Inferred-HIGH-confidence variant: (a) per-speaker minutes per episode (refines PRD-05 §6), (b) per-speaker words per episode (new), (c) host-vs-guest talking-time diff per episode (new). Plus three cross-cutting requirements: a global Confirmed/Inferred source toggle, a per-plot click-to-open-episode option, and dark/light theme support. Iterated as prototypes against the live podlog DB before authoring; see the prototyping log in `~/repos/playground/2026-05-15-podlog-meta-prototyping/`.

---

## 1. Problem Statement

PRD-05 added one speaker-oriented plot to `01_explore_db.ipynb`: per-speaker minutes per episode, with host detection by a 25%-of-episodes heuristic and one trace per confirmed speaker. Three things became friction once users started exploring:

1. **Source granularity.** The plot uses only `confirmed_by_user = TRUE` rows, but most of the database is unconfirmed inferred data (≈15 k inferred vs ≈700 confirmed rows). Users want to optionally switch to "inferred, HIGH confidence" without editing the cell.
2. **One metric.** Minutes-per-episode tells you airtime; **word count** tells you density. Users want both, with a consistent visual contract.
3. **Comparison view.** Per-speaker traces answer "how much did each person talk" but make it hard to answer "did the hosts dominate this episode, or did the guests?" — a per-episode signed comparison would.

This PRD specifies three plot families (six rendered figures total) plus three cross-cutting requirements that apply across all of them.

---

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

---

## 3. Shared Conventions

All six plots in this PRD live below the PRD-05 plot cells. They inherit every convention from **PRD-05 §3** (imports, renderer, `feed_short` mapping, color palettes, `_hex_to_rgba`, tz handling, legend placement). The additions / overrides below apply only to the plots in this PRD.

### 3.1a Source on the web page
Each plot family renders **two ChartCards side by side**: one Confirmed, one Inferred-HIGH. No interactive toggle — both are always visible. The card title carries the source label (e.g. *(Confirmed)* / *(Inferred — HIGH confidence)*).

### 3.1b Source toggle in the notebook
The notebook keeps the original ipywidgets `RadioButtons` design: a single widget at the top of the speaker-plots section drives all six figures via a callback that re-runs the query and `Plotly.react`s each figure. Two values:

| Value | SQL `WHERE` predicate |
|-------|-----------------------|
| `confirmed`     | `sn.confirmed_by_user = TRUE AND sn.role IN ('host', 'guest')` |
| `inferred_high` | `sn.inferred = TRUE AND sn.confidence = 'HIGH'`                 |

The toggle defaults to `confirmed`. The figure title for each plot includes a parenthetical source label (e.g. `*(Confirmed)*`).

### 3.2 Click-to-open episode (per-plot option)
Each speaker plot accepts an `enable_click_open: bool = True` parameter. When True:
- A `plotly_click` handler is attached that reads the last entry of `point.customdata` and calls `window.open(url, "_blank")` if it looks like a URL.
- The hover template ends with `<i>(click to open episode)</i>` as a discoverability hint.

When False, neither the handler nor the hint are emitted.

The target is the in-app episode page at `/episodes/{episode_id}`. In the web app, the click handler calls Next.js `router.push()` (no full reload). In the notebook, click-to-open opens `{PODLOG_WEB_URL}/episodes/{episode_id}` in a new tab; `PODLOG_WEB_URL` defaults to `http://localhost:3000` and can be overridden via env var.

### 3.3 Host / guest classification
Classification is now **role-column-first**, with a single fallback path for inferred speakers:

- **Source = `confirmed`:** a row's host/guest status comes from `speaker_names.role`. When the same `display_name` has both `host` and `guest` rows within a feed, the **majority wins** (ties default to host). Rows with `role = 'other'` or `role IS NULL` are excluded by the SQL `WHERE` above.

- **Source = `inferred_high`:** all such rows have `role IS NULL`, so:
  1. **Inherit from confirmed:** if the same `(feed, display_name)` is classified as host in the confirmed dataset, classify it as host here too; same for guest.
  2. **Fallback heuristic:** if the name is unknown to the confirmed table, fall back to the 25%-of-episodes heuristic from PRD-05 §6.2 (`HOST_THRESHOLD = 0.25`).

The fallback is intentional: in feeds that have **no** confirmed speakers, we still want a usable host axis. The heuristic is conservative — single-appearance speakers are correctly tagged as guests.

### 3.4 Guests are aggregated, hosts are not
For per-speaker plots (§4 minutes, §5 words):
- **Each host gets its own trace** (line + markers) — colors from `HOST_PALETTE` (`qualitative.D3`), solid line width 2, circle markers size 7.
- **All guests for a feed collapse into one combined "Guests (combined)" trace** — the per-episode y-value is the **sum** of all guests' values; the hover lists the comma-separated guest names. Color from `GUEST_PALETTE` (`qualitative.Pastel`, first color), dashed line width 1, diamond markers size 6.

This is a change from PRD-05 §6.4, which emitted one trace per guest. The combined view is easier to read on multi-guest feeds without losing per-person detail (the names are in the hover).

### 3.5 Unified hover + spike line
Speaker plots use:
```python
hovermode="x unified"
xaxis=dict(
    showspikes=True, spikemode="across",
    spikesnap="cursor", spikedash="dot", spikethickness=1,
)
```
This draws a vertical guide on hover and lists every visible trace's value at that x — important for the comparison plots and useful for the per-speaker plots when episodes from different speakers happen to coincide.

### 3.6 Theme — dark / light follows the podlog app
The web app's existing dark-mode class strategy (`<html class="dark">`) is the source of truth. The Plotly wrapper observes the `dark` class and re-applies `template: "plotly_dark"` / `"plotly_white"` on change without re-rendering data.

The notebook is intended to render inside the podlog app shell. Plot styling (paper background, plot background, font color, grid color, hover-box color) must follow the app's active theme. Two acceptable implementations, decide during build:

- **Plotly templates:** set `template="plotly_white"` or `"plotly_dark"` based on a Python-side flag read from the app, and re-`Plotly.relayout` on theme change.
- **CSS-variable driven:** set transparent backgrounds on the plotly traces, let the surrounding app CSS provide the colors via inherited `currentColor` and `--bg` variables, listen for a `prefers-color-scheme` / theme-class change with a tiny JS hook.

The first is simpler and is the default unless the second turns out to be needed for instant switching without re-render.

### 3.7 Per-feed dropdown
Each speaker plot keeps PRD-05 §6.5's per-feed `updatemenus` dropdown (top-left of plot area, `direction="down"`, `x=0.0`, `y=1.18`). Only one feed's traces are visible at a time. The title updates with the feed name, the source label (§3.1a / §3.1b), and any plot-specific subtitle (e.g. detected-hosts list, or per-feed summary stats for the diff plot).

---

## 4. Plot Family 4 — Per-speaker minutes per episode (×2)

### 4.1 Intent
For a given source (Confirmed or Inferred), show how each host's per-episode speaking time evolves across a podcast's run, with the combined guest airtime alongside for context.

This refines PRD-05 §6.

### 4.2 Data source & query
```sql
SELECT
    f.title          AS feed,
    e.id             AS episode_id,
    e.title          AS episode_title,
    e.episode_url,
    e.published_at,
    sn.display_name,
    sn.role,
    SUM(s.end_time - s.start_time) / 60.0 AS value   -- minutes
FROM segments s
JOIN episodes e ON e.id = s.episode_id
JOIN feeds    f ON f.id = e.feed_id
JOIN speaker_names sn
    ON sn.episode_id    = s.episode_id
   AND sn.speaker_label = s.speaker_label
WHERE e.published_at IS NOT NULL
  AND ({source_predicate})        -- from §3.1
GROUP BY f.title, e.id, e.title, e.episode_url, e.published_at, sn.display_name, sn.role
```

### 4.3 Aggregation
- Apply `feed_short` (PRD-05 §3.2) to feed titles.
- Strip tz: `pd.to_datetime(...).dt.tz_localize(None)`.
- Classify each `(feed, display_name)` as host/guest per §3.3.
- For each feed: per-host series is the raw rows for that name sorted by `published_at`.
- For each feed: the combined-guests series groups the non-host rows by `(episode_id, episode_title, episode_url, published_at)` and aggregates: `value = sum(value)`, `guest_count = nunique(display_name)`, `guest_names = ", ".join(sorted(unique(display_name)))`.

### 4.4 Visual encoding
See §3.4. Each host trace is solid line + circle markers in `HOST_PALETTE`. The combined-guests trace is dashed line + diamond markers in `GUEST_PALETTE[0]`. Markers + lines mode for both (`mode="markers+lines"`).

Legend names: `{display_name} (host)` and `Guests (combined)`. Hosts listed first in legend order, sorted by total minutes desc.

### 4.5 Hover (host trace)
```
{published_at|%Y-%m-%d}
{value:.1f} min
{episode_title}
(click to open episode)
```
The `<extra>` box shows `<b>{display_name}</b> (host)`.

### 4.6 Hover (combined-guests trace)
```
{published_at|%Y-%m-%d}
{value:.1f} min total
{guest_count} guest(s): {guest_names}
{episode_title}
(click to open episode)
```
The `<extra>` box shows `<b>Guests</b> (combined)`.

### 4.7 Layout
- Title: `Per-speaker minutes per episode — {feed} <i>({source_label})</i>` with a `<sub>` subtitle listing detected hosts (or `(none detected)`).
- Y-axis: `ticksuffix=" min"`.
- `margin=dict(b=160, t=110)` for legend below + dropdown above.
- Hover / spike: §3.5.
- Dropdown: §3.7.

### 4.8 Source variants rendered
Two cells, slugs `04a_speakers_minutes_confirmed` and `04b_speakers_minutes_inferred_high`. (Numbering relative to this PRD's plots; in the notebook they extend the PRD-05 sequence.)

---

## 5. Plot Family 5 — Per-speaker words per episode (×2)

### 5.1 Intent
Same structural answer as §4, but counting **words spoken** instead of minutes. Useful for spotting speakers who talk a lot in absolute airtime but at low density, vs speakers who pack a lot into less time.

### 5.2 Data source & query
Identical to §4.2 except the `value` expression:
```sql
COALESCE(
    SUM(
        CASE WHEN length(trim(s.text)) > 0
             THEN array_length(regexp_split_to_array(trim(s.text), '\s+'), 1)
             ELSE 0
        END
    ),
    0
) AS value
```
Whitespace-tokenised word count per segment, summed per speaker per episode. NULL/empty `s.text` rows are dropped from the count (but the speaker may still have other segments that contribute).

### 5.3 Aggregation
Identical to §4.3 with `value` now in words. The combined-guests trace sums words across all guests for the episode.

### 5.4 Visual encoding
Identical to §4.4.

### 5.5 Hover (host trace)
```
{published_at|%Y-%m-%d}
{value:,.0f} words
{episode_title}
(click to open episode)
```

### 5.6 Hover (combined-guests trace)
```
{published_at|%Y-%m-%d}
{value:,.0f} words total
{guest_count} guest(s): {guest_names}
{episode_title}
(click to open episode)
```

### 5.7 Layout
- Title: `Per-speaker word count per episode — {feed} <i>({source_label})</i>` with detected-hosts subtitle.
- Y-axis: no tick suffix; format `,.0f` (thousands separator).
- Everything else as §4.7.

### 5.8 Source variants rendered
Two cells: `05a_speakers_words_confirmed`, `05b_speakers_words_inferred_high`.

---

## 6. Plot Family 6 — Host vs Guest talking-time diff per episode (×2)

### 6.1 Intent
**One number per episode** that says, on a per-person average basis, who talked more: hosts or guests. A horizontal reference line at y=0 splits the chart visually:

- **Above 0:** guests talked more on average.
- **Below 0:** hosts talked more on average.

A shaded band around the line shows the widest possible diff given individual-speaker variation, so an episode with a wide spread (e.g. two hosts of very different airtime) reads as more uncertain.

### 6.2 Data source & query
Same query as §4.2 (minutes). The diff plot is derived from the same row-level dataset as the minutes per-speaker plot.

### 6.3 Aggregation
For each `(feed, episode_id)`:
1. Split the rows into a host-set and a guest-set using the classification from §3.3.
2. **Skip episodes that don't have at least one host AND one guest** — there's nothing to compare.
3. Compute per-side statistics:
   - `host_mean`, `host_min`, `host_max`, `host_count`, `host_names` (sorted unique)
   - `guest_mean`, `guest_min`, `guest_max`, `guest_count`, `guest_names` (sorted unique)
4. Compute the comparison:
   - `diff   = guest_mean − host_mean`
   - `band_lo = guest_min − host_max`  *(lower bound — quietest guest vs loudest host)*
   - `band_hi = guest_max − host_min`  *(upper bound — loudest guest vs quietest host)*

### 6.4 Visual encoding
Per feed, three traces, all sharing the feed's palette color (`PALETTE` = `qualitative.Plotly`, indexed by feed order):

1. Invisible upper-band line at `band_hi` (`line.width=0`, `hoverinfo="skip"`, `showlegend=False`).
2. Invisible lower-band line at `band_lo` with `fill="tonexty"` and translucent fillcolor (alpha 0.18) — fills the band against the upper line.
3. Center line: `mode="markers+lines"` at `diff`, solid line width 2, circle markers size 7.

A dotted horizontal reference at y=0 (`fig.add_hline(y=0, line=dict(color="#888", width=1, dash="dot"))`).

Only one feed's three traces are visible at a time (per-feed dropdown, §3.7).

### 6.5 Hover (center line)
```
{published_at|%Y-%m-%d}
Δ = {diff:+.1f} min  (guest − host avg)
Hosts ({host_count}, avg {host_mean:.1f} min): {host_names}
Guests ({guest_count}, avg {guest_mean:.1f} min): {guest_names}
{episode_title}
(click to open episode)
```
The `<extra>` box shows the feed name.

### 6.6 Layout
- Title: `Host vs Guest talking time per episode — {feed} <i>({source_label})</i>`.
- Subtitle (`<sub>`): per-feed summary `"{n} episode(s) compared — guests talked more in {x}, hosts in {y}"`. Re-computed in each dropdown button's update payload.
- Y-axis: `yaxis_title="Δ minutes (guest avg − host avg)"`, `ticksuffix=" min"`, `zeroline=False` (the reference at y=0 is the explicit dotted hline, not Plotly's default zeroline).
- Hover / spike: §3.5.
- Dropdown: §3.7. Direction `"down"`, position `(x=0, y=1.18)`.
- `margin=dict(b=160, t=110)`.

### 6.7 Source variants rendered
Two cells: `06a_speakers_diff_confirmed`, `06b_speakers_diff_inferred_high`.

---

## 7. Cross-cutting requirements summary

These appear across every plot in this PRD and should be implemented at the helper / cell-skeleton level rather than copy-pasted:

| # | Requirement | Default | Where it lives |
|---|-------------|---------|----------------|
| 1 | Source variant (Confirmed / Inferred-HIGH) | `confirmed` | Web page: both rendered statically (§3.1a). Notebook: ipywidgets toggle (§3.1b). |
| 2 | Click-to-open episode (per-plot) | `True` | `enable_click_open: bool = True` param on each speaker plot function (§3.2) |
| 3 | Theme follows podlog app | (auto) | Helper that sets `template` and listens for theme changes (§3.6) |

When `enable_click_open=False`, both the `plotly_click` JS handler and the `(click to open episode)` hint in the hover template must be omitted.

---

## 8. Operational Notes

### 8.1 Rendering to standalone HTML
Same as PRD-05 §7.1. `nbconvert` with the inline plotly.js renderer (PRD-05 §3.1) produces a self-contained `.html`. With six new speaker figures added, expect the rendered HTML to grow by roughly the size of one plotly.js bundle plus the additional figure JSON (~5 MB total for the speaker section).

### 8.2 Notebook-vs-IDE editing conflict
PRD-05 §7.3 still applies. The proxy `.py` script used during prototyping (`~/repos/playground/2026-05-15-podlog-meta-prototyping/plots.py`) shows the full implementation outside the notebook — useful when iterating without IDE clobbering risk.

### 8.3 Inferred-source noise
HIGH-confidence inferred names include:
- Real names (`Lenny Rachitsky`, `Marko Papic`)
- Name fragments treated as separate identities (`Marko`, `Papic`)
- False positives that are clearly not people (`Twitter`, `Linkedin`)

Document this in the cell's leading markdown so users reading the "Inferred" view know what they're looking at. Filtering is out of scope for v1.0 (see §10).

### 8.4 Click-to-open behavior on missing URLs
If an episode has `episode_url IS NULL` (or, post-implementation, no in-podlog page yet), the click handler is a no-op — no popup, no error. This is the desired behavior.

---

## 9. Migration notes from PRD-05

PRD-05 §6 ("Per-speaker minutes per episode") is **superseded** by §4 of this PRD. The differences are summarised here so the PRD-05 cell can be deleted cleanly during implementation:

| Aspect | PRD-05 §6 | This PRD §4 |
|--------|-----------|-------------|
| Source | confirmed only | confirmed **or** inferred-HIGH (toggle) |
| Host detection | 25%-of-episodes heuristic | `role` column first; heuristic only as inferred fallback |
| Guest traces | one per guest | one combined "Guests" trace per feed |
| Hover | per-point | x-unified + spike line |
| Click | none | opens episode in podlog (toggleable) |
| Excluded | (none) | `role = 'other'` (confirmed source) |

---

## 10. Future Extensions (out of scope for v1.0)

- **Name normalisation for inferred sources.** Fuzzy-merge fragments (`Marko` → `Marko Papic`), denylist obvious junk (`Twitter`, `Linkedin`, single-token English words). Would substantially improve the inferred plots.
- **Episode list table below the plot.** Static or zoom-aware table of episodes currently in view (~10 rows) with date, title, and a deep link. Considered during prototyping; deferred so the click-to-open could land first.
- **Word-count-based diff plot.** Mirror §6 using words instead of minutes — answers "who dominated by density" rather than "who dominated by airtime."
- **Stacked-area cumulative airtime** per feed (hosts vs guests over time).
- **Per-feed configurable host threshold** when the heuristic fallback is in play (currently global `HOST_THRESHOLD = 0.25`).
- **Tighter integration with PRD-04's recurring-host signal** once it's mature — swap the local fallback heuristic for the pipeline-level signal.
- **Token counts (tiktoken) for the words plot family**, for comparability with LLM context budgets.
