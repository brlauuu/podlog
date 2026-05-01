# pyannote Cloud Diarization (Precision-2)

Podlog's diarization step (labeling *who* spoke *when*) has two provider options:

| Provider | Model | Runs on | Cost |
|---|---|---|---|
| **Local (default)** | `pyannote/speaker-diarization-community-1` | Your machine | Free |
| **pyannote Cloud** | `precision-2` | pyannote.ai servers | Paid, per second of audio |

The local model is the default and is what you get out of the box after accepting the free HuggingFace license. This page is about the optional paid cloud provider, which pyannote.ai describes as "~28% more accurate than `community-1`" on benchmark data.

## When to enable cloud diarization

Cloud (`precision-2`) is worth turning on when:

- Your local machine doesn't have the ~2 GB of RAM pyannote needs, or diarization is the bottleneck in your processing time.
- You're running long, multi-speaker conversations where speaker accuracy matters more than cost.
- You want to offload CPU work so transcription and diarization can run in parallel.

Keep **local** (free) when:

- You're fine with the accuracy of `community-1` (which is good — 28% is a ceiling; most podcasts do well on the free model).
- You don't want your audio leaving your machine.
- You're processing large backlogs and the per-second cost would add up.

## Setup

### 1. Create a pyannote.ai account

Go to **https://dashboard.pyannote.ai** and sign up. The dashboard is where you'll manage billing, generate API keys, and check per-tier pricing. Podlog does not know your rate; it only knows what you tell it (see step 3).

### 2. Generate an API key

In the pyannote.ai dashboard, create a new API key. Copy it — you'll paste it into Podlog Settings next.

> **Security note.** The key lets anyone submit audio to your pyannote.ai account and run up your bill. Treat it like a password. Podlog masks it on read (the Settings UI shows `pn_***890`) and stores it in the `system_state` table, not in plain env files (unless you choose to set `PYANNOTE_API_KEY` via `.env`).

### 3. Configure Podlog

Open Podlog at **http://localhost:3000/settings** and click the **Remote Inference** tab.

1. Paste your API key into **pyannote cloud API key**.
2. (Optional) Expand **What is pyannote cloud (Precision-2)?** for the inline summary.
3. (Optional) Set your per-second rate in the settings DB so the episode cost chip shows an estimate. The rate lives under `pyannote_cloud_cost_per_second_usd` — since the dashboard page varies by tier and is not publicly documented, Podlog cannot guess. If you leave it at the default `0`, the feature still works but the cost chip shows `$—` (see *Cost display* below).
4. Scroll to the **Pipeline Steps** section and flip the **Diarization** toggle from **Local** to **Remote**. Confirm the dropdown now shows `pyannote precision-2 (paid, hosted)`.
5. Click **Save**.

Future episodes will be diarized via pyannote cloud. Existing episodes keep whatever labels they already have — reprocess them from the episode page if you want their labels regenerated with `precision-2`.

## How it works under the hood

For each diarize job, Podlog:

1. Uploads the episode's audio to pyannote.ai temporary storage (`POST /v1/media/input` → PUT to a presigned URL).
2. Submits a diarization job (`POST /v1/diarize` with `model: "precision-2"`).
3. Polls the job every 2–10 seconds until it reaches a terminal state (`succeeded`, `failed`, or `canceled`). Hard timeout is 30 minutes.
4. On success, converts the returned speaker segments to Podlog's internal shape and writes them to the `segments` table — the rest of the pipeline (chunk, embed, infer) is unchanged.

If the cloud request fails, the episode is kept with `has_diarization = false` and `diarization_error` populated — the same graceful-failure contract used for local pyannote failures (PRD-01 §5.5). The transcript itself is not lost.

## Cost and billing

pyannote.ai bills **per second of audio processed**, with a **20-second per-request minimum**. The exact rate depends on your account tier — check https://dashboard.pyannote.ai for the number that applies to you.

Podlog records an estimated cost per episode in the `pyannote_cloud_cost_usd` column. The calculation is:

```
billed_secs = max(20, <end of last speaker segment> − <start of first speaker segment>)
cost_usd    = billed_secs × pyannote_cloud_cost_per_second_usd
```

This is a **local estimate**, not reconciled billing. The authoritative amount is on your pyannote.ai dashboard.

### Cost display on episodes

After diarization runs, episode cards and the episode detail page show a **pyannote cloud** chip:

- **`pyannote cloud: $0.03`** — rate is configured and we computed an estimate.
- **`pyannote cloud: $—`** — rate is set to `0` (or unset). The hover tooltip explains: *"Cost estimate unavailable — set your per-second rate in Settings > Remote Inference to show an estimate here. Actual billing is on your pyannote.ai dashboard."* This does **not** mean "no charge"; pyannote did bill you — Podlog just can't estimate the amount without your tier's rate.

## Data retention and privacy

- **Audio uploaded to pyannote.ai is auto-deleted ~24 hours after job completion** (per pyannote.ai's data-retention policy).
- **Results are also cleaned up after 24 hours.** Podlog fetches the diarization output in the same call as polling, so this is not an operational concern — but it does mean you cannot re-fetch a `jobId` later.
- **When to keep local instead:** if your audio contains sensitive conversations, regulated content, or anything subject to a no-external-egress policy, stay on the free local provider. Enabling cloud means audio leaves your machine.

## Troubleshooting

- **401 Unauthorized when a job runs** — the API key is invalid, revoked, or wasn't saved in Settings. Verify at `GET /v1/test` via `curl -H 'Authorization: Bearer <key>' https://api.pyannote.ai/v1/test`, or re-paste the key in Settings.
- **Jobs time out after 30 minutes** — extremely long episodes (multi-hour) can hit the poll-timeout guard. If this is a regular pattern, file an issue — we may need to make the timeout configurable.
- **`Cost estimate unavailable` on every episode** — set `pyannote_cloud_cost_per_second_usd` to a non-zero number in Settings. Get the rate from your pyannote.ai dashboard.
- **Diarization toggle is disabled** — save an API key first. Without a key, flipping the toggle pops a dialog requesting it.
- **Cloud works, local doesn't** (or vice versa) — the two providers are independent. Swapping between them in Settings is instant; no restart needed.

## Env var equivalents

If you prefer `.env` over the Settings UI, the following env vars map to the Settings tab controls:

```bash
DIARIZATION_PROVIDER=precision2          # or "local"
PYANNOTE_API_KEY=pn_xxxxxxxxxxxxxxxxxxxx
PYANNOTE_CLOUD_BASE_URL=https://api.pyannote.ai/v1
PYANNOTE_CLOUD_MODEL=precision-2         # precision-2 | community-1
PYANNOTE_CLOUD_COST_PER_SECOND_USD=0.0   # set to your dashboard rate
```

DB-backed Settings values take precedence over env vars — the env values act as defaults on first boot.

## Relationship to Fireworks STT

`INFERENCE_PROVIDER=fireworks` (Fireworks transcription) takes precedence over `DIARIZATION_PROVIDER`. Fireworks returns diarization metadata inline with its transcription, so running cloud diarization on top would be double-billing. If you have both set, Fireworks wins for both transcription and diarization.

Pairing **local Fireworks-less transcription** with **pyannote cloud diarization** is the main use case for this feature.

---

**Next:** [Meta-Analysis Dashboard](14-meta-analysis.md) | **Back:** [Ask AI (RAG Search)](12-rag-search.md) | **Home:** [Guide](README.md)
