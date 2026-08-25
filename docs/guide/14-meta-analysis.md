# Meta-Analysis Dashboard

The Meta-Analysis page at `/meta-analysis` charts who talks, and for how long, across your library. It answers questions the search box cannot: is this show host-led or guest-led, is a cohost's airtime growing over the run, which episodes are outliers.

It is a speaker-analytics page, not a general library dashboard. Episode counts, processing times and costs live on the [Queue Dashboard](08-queue.md) and the episode pages.

## Opening the dashboard

From the navbar click **Meta-analysis**, or press <kbd>G</kbd> <kbd>M</kbd>, or go to [http://localhost:3000/meta-analysis](http://localhost:3000/meta-analysis).

If nothing has been computed yet you'll see *"No analysis yet — hit ↻ Refresh or wait for the queue to drain."* The dashboard never computes on page load; see [Refreshing the snapshot](#refreshing-the-snapshot) below.

## What's on the page

**A coverage line** at the top: how many podcasts and how many processed episodes the snapshot covers, plus a **missing speakers** link that opens a per-podcast breakdown of speakers excluded from the host/guest chart.

**A filter bar** listing **All podcasts** plus one button per feed. It is single-select — click a podcast to restrict every chart to it, click **All podcasts** to go back. There is no date or episode-length filter.

**A Confirmed / Inferred — HIGH switch.** Every chart is drawn from one of two speaker sets:

- **Confirmed** — only names you have confirmed yourself. Fewer rows, no guesses.
- **Inferred — HIGH** — adds high-confidence automatic detections. More rows, and some noise: obvious platform tokens (Twitter, LinkedIn, …) are filtered out, and first-name fragments are merged into the longest matching name within the same feed, so "Marko" folds into "Marko Papic".

**Three charts**, stacked in one column.

## The charts

| Chart | What it shows |
|---|---|
| **Per-speaker minutes per episode** | Each host's airtime across the podcast's run, episode by episode. Guests are collapsed into a single dashed trace per feed — hover to see who they were. |
| **Per-speaker word count per episode** | The same shape, measured in words instead of minutes. Reading the two together separates "talked longer" from "talked faster". |
| **Host vs Guest talking time per episode** | One signed value per episode: guest average minus host average. Above zero, guests dominated; below zero, the hosts did. The shaded band shows the widest delta the individual speaker variation allows. |

The page has a collapsible **What do these charts show?** panel at the bottom repeating this in the app itself.

## Refreshing the snapshot

The dashboard reads a stored snapshot so the page loads instantly — it never recomputes on view.

- Click **↻ Refresh** in the top-right to recompute now.
- Or call `POST /api/meta-analysis/refresh` directly.

Under the header you'll see **Updated \<date and time\>**, or **Never computed**. When something has changed the numbers since the snapshot was taken — a rename, a newly finished episode — a **Refresh pending** badge appears next to it. The worker also recomputes stale snapshots on its own once the queue drains, so the badge usually clears by itself.

## Jupyter status

If you use the optional [Jupyter explore container](15-explore.md), a small panel on this page shows whether it is running and links to it. When it isn't running, the panel links to the guide instead. Starting and stopping it stays on the command line.

## When to use it

- To see whether a show is host-led or guest-led, and whether that has changed over its run.
- To spot an episode where one speaker's airtime is wildly out of line with the rest.
- To check how much of your library has confirmed speaker names — compare the Confirmed and Inferred — HIGH views, and use the missing-speakers link to see what's excluded.
- Before a broad Ask AI question, to confirm the speakers you care about are actually named.

---

**Next:** [Database Exploration with Jupyter](15-explore.md) | **Back:** [pyannote Cloud Diarization](13-pyannote-cloud.md) | **Home:** [Guide](README.md)
