# Meta-Analysis Dashboard

The Meta-Analysis page at `/meta-analysis` aggregates metrics across all your feeds into one view. Useful for spotting outlier episodes, comparing podcasts, and tracking how much of your library is fully processed.

## Opening the dashboard

From the navbar click **Meta-Analysis**, or go directly to [http://localhost:3000/meta-analysis](http://localhost:3000/meta-analysis).

The page shows:

- A **Coverage strip** at the top — how many episodes are fully processed, still queued, partially transcribed, or missing speakers.
- A **Filters bar** — narrow the view to a subset of feeds, a date range, or episode length.
- Nine **charts** (see below). Click a chart to open a full-size modal with the raw data table underneath.

## Charts

| Chart | What it shows |
|---|---|
| **Release Timeline** | Episode release cadence per feed over time |
| **Length per Feed** | Episode duration distribution by feed |
| **Episode Length Trend** | How episode length has evolved per feed over time |
| **WPM per Speaker** | Words-per-minute by speaker (useful for spotting hosts vs. guests) |
| **Turn Density** | How often speakers switch per minute — a proxy for conversational format vs. monologue |
| **Host / Guest Share** | Time-share between inferred hosts and guests per episode |
| **Tokens per Episode** | LLM token count per episode (approximate; used for cost estimation) |
| **Processing Time Distribution** | How long each pipeline stage takes per episode |
| **Cost per Feed** | Cumulative pyannote cloud + remote-inference cost per feed (only populated if you use paid providers) |

## Refreshing the snapshot

The dashboard reads from a cached snapshot so the page loads instantly. To recompute:

- Click **Refresh snapshot** in the top-right.
- Or call `POST /api/meta-analysis/refresh` directly — the pipeline recomputes and stores the snapshot.

Staleness indicators show the snapshot age next to the refresh button.

## When to use it

- After a large batch ingest, to confirm all episodes reached the archive stage.
- Before running a big Ask AI query, to see which feeds have full speaker inference.
- To compare podcasts by pace, format, or topic density.
- To track spend if you use the pyannote cloud provider or Fireworks remote inference.

---

**Next:** [Database Exploration with Jupyter](16-explore.md) | **Back:** [Chunked Fireworks Transcription](14-chunked-fireworks.md) | **Home:** [Guide](README.md)
