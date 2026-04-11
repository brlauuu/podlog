# Settings Page Redesign: Notifications & Remote Inference

**Issue:** #322
**Date:** 2026-04-11

## Overview

Redesign the `/settings` page from a tabbed layout into two vertically stacked sections — Notifications and Remote Inference — following the monochromatic design system. The Remote Inference section introduces per-step local/remote configuration with hardware-aware cost estimates.

## Page Layout

Two sections separated by a `Separator`. Single Save button at the bottom saves all settings in one PUT call.

## Section 1: Notifications

Three inline subsections (no tabs), each in a subtle card border:

### Telegram
- Bot token and chat ID text inputs
- Test button
- Collapsible setup guide

### Email
- Recipient tag input (comma-separated, Enter/Backspace handling — existing `EmailTagInput` component)
- SMTP fields: host, port, user, password, use TLS
- Test button
- Collapsible setup guide

### General
- Frequency toggle: immediate / daily / weekly
- Health check notification toggle

All existing functionality preserved. Restyled from tabs to inline subsections with monochromatic styling.

## Section 2: Remote Inference

### Provider Selection
- Dropdown (`Select`): "Remote inference provider" — only "Fireworks AI" available
- Collapsible explainer below: what remote inference providers are, why to use one

### API Key
- Text input for Fireworks API key with show/hide toggle (eye icon)
- Stored as `fireworks_api_key` in existing settings blob
- On save, if key is non-empty, backend makes a lightweight Fireworks API call to validate. If validation fails, settings still save but a toast warns "Fireworks API key could not be validated — check that it's correct."

### Validation Gate
- If a user toggles any step to "remote" and the API key field is empty, show an error dialog explaining they need a valid API key first, and revert the toggle to "local"
- Client-side validation, no save needed

### Per-Step Pipeline Cards

Five cards, one per pipeline step:

| Step | Toggle | Local Models | Remote Models |
|---|---|---|---|
| Transcription | Enabled | `large-v3-turbo` | Fireworks STT models |
| Diarization | Disabled (locked local) | `speaker-diarization-3.1` | — |
| Speaker Inference | Disabled (locked local) | `en_core_web_lg` | — |
| Embedding | Enabled | `all-MiniLM-L6-v2` | Fireworks BGE models |
| RAG / Ask | Disabled (locked local) | Ollama (local) | — |

Each card contains:
- **Title** — step name
- **"?" help popover** — opaque background (`bg-background`), explains what the step does. For steps with remote option: includes hardware-aware cost/speed estimates (see below)
- **Local/Remote toggle** — `Switch` component. Disabled toggles are grayed out (`opacity-50`, `cursor-not-allowed`). Disabled step popovers explain why ("Speaker diarization is currently supported locally only.")
- **Model dropdown** — `Select` component showing available models for current mode. Updates when toggle flips. Even single-model steps show the dropdown. Disabled for locked-local steps.

### Hardware Detection & Cost Estimates

**New pipeline endpoint:** `GET /api/hardware`

1. Reads `/proc/cpuinfo` for CPU model and core count
2. Checks `torch.cuda.is_available()` + GPU name if present
3. Queries `/proc/meminfo` for total RAM
4. Maps detected hardware to a performance profile from a hardcoded lookup table
5. Respects `HARDWARE_PROFILE` env var — if set, skips auto-detection
6. Returns: `{ cpu, gpu, ram_gb, profile_name, estimates: { transcription_minutes_per_hour, embedding_seconds_per_hour } }`

**New web proxy:** `GET /api/hardware` route proxying to pipeline.

**Frontend usage:** "?" popovers on Transcription and Embedding cards fetch hardware info once (cached in state) and display:

> "On your detected hardware (AMD Ryzen 7, 32GB RAM, no GPU), transcribing a 60-minute episode takes approximately 45 minutes locally. With Fireworks AI, the same episode takes approximately 3 minutes and costs ~$0.36."

If hardware detection fails and no `HARDWARE_PROFILE` is set, only show remote cost estimate.

**Explainer section:** Collapsible "How are these estimates calculated?" at the bottom of Remote Inference, explaining local estimates come from hardware profiles and remote costs use per-minute pricing.

## Components & File Structure

### shadcn components to install
- `switch`
- `select`
- `popover`
- `collapsible`

### File changes

| File | Action |
|---|---|
| `NotificationSettings.tsx` | Rewrite — two sections, single save, hardware fetch |
| `NotificationSettingsSections.tsx` | Remove — replaced by two new files |
| `NotificationSection.tsx` | New — Telegram, Email, General subsections |
| `RemoteInferenceSection.tsx` | New — provider, API key, 5 step cards, estimates, explainer |
| `apps/web/src/app/api/hardware/route.ts` | New — proxy to pipeline |
| `apps/pipeline/app/api/hardware.py` | New — hardware detection endpoint |
| `apps/pipeline/app/services/hardware.py` | New — hardware detection + profile matching logic |
| `apps/pipeline/app/config.py` | Extend — `HARDWARE_PROFILE` env var, per-step config defaults |
| `apps/pipeline/app/services/notification_settings.py` | Extend — validate new per-step fields |
| `apps/pipeline/app/main.py` | Register hardware router |

### Settings keys (in SystemState JSON blob)

Existing keys used as-is — no new keys needed for provider/model selection:

- `inference_provider`: `"local"` | `"fireworks"` — controls transcription provider
- `fireworks_stt_model` — remote transcription model
- `embedding_provider`: `"local"` | `"fireworks"` — controls embedding provider
- `embedding_model` — local embedding model (default `"all-MiniLM-L6-v2"`)
- `fireworks_embedding_model` — remote embedding model
- `fireworks_api_key` — API key for Fireworks

The frontend maps these to the per-step card toggles and dropdowns. The "Transcription" card toggle writes to `inference_provider`, the "Embedding" card toggle writes to `embedding_provider`.

## Styling Rules

- All cards, toggles, dropdowns, borders stay within theme grayscale
- Only the Save button uses `bg-action text-action-foreground`
- Help popovers use `bg-background` (opaque, not translucent)
- Disabled toggles get `opacity-50` with `cursor-not-allowed`
- Collapsible sections use shadcn `Collapsible`
- No emojis

## Backend: No New Migrations

All new config extends the existing `SystemState` JSON blob. Validation added to `notification_settings.py`. No Alembic migration needed.
