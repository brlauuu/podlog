# Inference Providers

Podlog's pipeline has two heavy ML stages — **transcription** and **diarization** — and each can run either locally or against a paid cloud provider. This page lays out the options side by side so you can pick what fits your hardware, budget, and privacy preferences.

If you're new to Podlog, the defaults are all-local: no API keys, no data leaves your machine, no cost. You can stay on the defaults forever. The remote options exist for users whose hardware is the bottleneck or who want better non-English accuracy.

## The two stages

| Stage | What it does | Local default | Remote option |
|---|---|---|---|
| **Transcription** | Audio → text with word-level timestamps | WhisperX (CTranslate2 backend) | Fireworks AI |
| **Diarization** | Labels who spoke when, per segment | pyannote `community-1` | pyannote.ai `precision-2` |

The two stages are independent — you can mix and match (e.g. local Whisper + cloud diarization, or remote Whisper + local diarization).

## Transcription

| Provider | Model | Runs on | Cost | Setup |
|---|---|---|---|---|
| **Local (default)** | WhisperX `large-v3-turbo` | Your machine | Free | Built in; configurable via `WHISPER_MODEL` |
| **Fireworks AI** | Whisper-v3 (hosted) | Fireworks servers | Paid, ~$0.0015/min | `INFERENCE_PROVIDER=fireworks` + `FIREWORKS_API_KEY` |

### Local transcription (WhisperX)

This is the default. WhisperX runs the Whisper model via the CTranslate2 backend, which is materially faster than the reference PyTorch implementation on CPU. The default model is `large-v3-turbo`. You can swap it via `WHISPER_MODEL` in `.env` — see [Configuration](10-configuration.md#which-whisper-model-should-i-pick) for the size/quality/RAM table.

A `large-v3-turbo` episode of average podcast length takes ~1–2× real-time on an 8-core CPU machine, in our experience. See [Hardware & Performance](11-hardware.md) for measured numbers.

### Remote transcription (Fireworks)

Set in `.env`:

```bash
INFERENCE_PROVIDER=fireworks
FIREWORKS_API_KEY=fk_...
FIREWORKS_AUDIO_BASE_URL=https://audio-prod.us-virginia-1.direct.fireworks.ai
```

Then `make up-remote` instead of `make up` to use the remote-inference Compose profile (no local Ollama container, since Ask AI also routes to Fireworks).

Fireworks returns word-level timestamps and (optionally) per-segment diarization metadata in the same response — when present, this metadata is preferred over a separate diarization pass (see PRD-01 §5.5 for the precedence rules).

## Diarization

| Provider | Model | Runs on | Cost | Setup |
|---|---|---|---|---|
| **Local (default)** | `pyannote/speaker-diarization-community-1` | Your machine | Free | `HF_TOKEN` in `.env` + accept the model license |
| **pyannote.ai Cloud** | `precision-2` | pyannote.ai servers | Paid, per-second of audio | See [pyannote Cloud Diarization](13-pyannote-cloud.md) |

### Local diarization (pyannote community-1)

Default. Requires a (free) HuggingFace token and one-time license acceptance on the model page — covered in [Installation](01-installation.md#prerequisites).

A useful property: **diarization failure is non-fatal.** If pyannote can't load or fails on a particular episode, the transcript is still written with `speaker_label = NULL` and `has_diarization = false`. You don't lose the transcript.

### Remote diarization (pyannote.ai precision-2)

pyannote.ai's hosted `precision-2` model — they describe it as "~28% more accurate than `community-1`" on benchmark data. Full setup, cost configuration, and how it interacts with the local pipeline is documented in [pyannote Cloud Diarization](13-pyannote-cloud.md).

## When to use which

| If you... | Pick |
|---|---|
| Want zero recurring cost and full privacy | All local (default) |
| Have a slow/small machine and want faster turnaround | Remote transcription (Fireworks) |
| Care about speaker-label accuracy on long multi-speaker shows | Remote diarization (precision-2) |
| Process mostly English | Local Whisper is fine |
| Process under-represented languages where Whisper struggles | Remote (Fireworks Whisper-v3 is the same model, but for non-English you might also evaluate alternatives — see *Considered and rejected* below) |
| Have a regulated or sensitive corpus | Stay local |

## A note on memory: Whisper and pyannote never coexist

On CPU-only hardware, loading WhisperX and pyannote simultaneously will OOM on most machines. The pipeline explicitly unloads Whisper (with `gc.collect()`) before pyannote is loaded for the diarization stage. This is why the two stages are sequential tasks rather than a single pass.

If you've enabled remote diarization (`precision-2`), the local pyannote model is never loaded — which frees up RAM but doesn't change the stage ordering. See **PRD-01 §5.4** for the full constraint discussion.

## Considered and rejected

To save future maintainers from re-litigating decisions that have already been made, we record providers that were evaluated and consciously *not* shipped.

### Soniox (transcription + diarization in one call)

**Considered:** [#757](https://github.com/brlauuu/podlog/issues/757). **Closed as:** not planned.

**What it offers.** Soniox is a single-call API that returns word-level transcription, speaker labels, and language tags in one response — collapsing Podlog's two-stage Whisper-then-pyannote flow into one HTTP request. Vendor benchmarks claim ~6.5% WER on English vs ~10.5% for OpenAI Whisper, with bigger gains in non-English languages. Pricing is ~$0.10/hr of audio, diarization included — roughly 8× cheaper than the current Fireworks + precision-2 pairing.

**Why not now.** The pipeline today is structured around two distinct stages — `transcribe` then `diarize` — each with its own task, its own provider seam (`INFERENCE_PROVIDER`, `DIARIZATION_PROVIDER`), its own cost-tracking columns, and its own error-classification path. A single-call provider doesn't fit cleanly behind either seam: shipping it well would mean restructuring the task graph so one provider can satisfy both stages, plus a new set of env vars, a new service module, new cost columns, an Alembic migration, UI changes in Settings, and tests on both sides. Substantial work, and the existing Fireworks + precision-2 combination is meeting the project's needs.

Revisit if (a) Fireworks or pyannote.ai cost becomes a real problem, (b) we need materially better non-English WER, or (c) the two-stage memory dance becomes the bottleneck again. The full evaluation and an implementation plan on paper live on [#757](https://github.com/brlauuu/podlog/issues/757).
