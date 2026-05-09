# Changelog

All notable changes to Podlog are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html). Pre-v1 versions follow `0.x.y` and may break compatibility between minor bumps.

Each release section groups changes as:

- **Major changes** — new features users will notice
- **Minor changes** — refinements, performance work, smaller UX wins
- **Fixes** — bug fixes
- (Optional) **Internal** — refactors, infra, dev tooling

<!--
Contributing: every PR with user-visible behavior should add a one-line entry
under the appropriate `Unreleased` heading below. When a release is cut via
the `release` skill, `Unreleased` graduates to a dated version section and a
fresh empty `Unreleased` is left at the top.
-->

## Unreleased

### Major changes
- Per-active-provider queue ETA in notifications. The "Est. time left" line in episode notifications now uses the rate of episodes processed by whichever inference provider is currently configured, and tags the line with `(local)` or `(remote)` so the basis is visible. ([#595](https://github.com/brlauuu/podlog/pull/595))
- Distinct error class for Fireworks upload rejections. When Fireworks aborts an upload at the TLS layer (typically size/duration cap), the failure is classified as `FIREWORKS_UPLOAD_REJECTED`, the retry loop is skipped, and notifications carry an "Action required: re-run on local inference" call-to-action. ([#602](https://github.com/brlauuu/podlog/pull/602))
- RAG / Ask is now an independently toggleable remote-inference step in Settings. Pick local Ollama or Fireworks AI from a curated list of chat models (Qwen2.5 7B Instruct, Llama 3.1 70B Instruct, Qwen2.5 72B Instruct). The Ask page model dropdown re-renders to match the active provider and migrates any stale `localStorage` selection automatically. The Remote Inference section also gets an explicit privacy notice spelling out that data for any step set to remote (audio, transcripts, queries, retrieved chunks, embedding inputs) leaves the local machine. Default for new installs and existing upgrades remains local. ([#608](https://github.com/brlauuu/podlog/issues/608))
- **Editable LLM system prompts.** Settings → Prompts (new tab) lets you edit the system prompt sent to the LLM for the Ask page and the per-episode Ask popup independently. Build-time defaults come from `PROMPT_ASK_PAGE_SYSTEM` / `PROMPT_ASK_EPISODE_SYSTEM` env vars; UI saves are stored in a new `prompt_settings` table; **Reset to default** clears the override and falls back to the env value. Both prompts ship with the same default text but can diverge after editing. ([#643](https://github.com/brlauuu/podlog/issues/643))
- **Daily backups of the database and audio archive.** New `backup` Docker service runs as part of the standard stack, writes `pg_dump --format=custom` files and incremental `rsync --link-dest` audio snapshots to `./backups/` on the host. Retention is 7 daily / 4 weekly / 12 monthly (configurable, set any to 0 to disable). Restore via `make restore-db DATE=...` and `make restore-audio DATE=...` with confirmation prompts. Idempotent across container restarts. See `docs/guide/16-backups.md`. ([#630](https://github.com/brlauuu/podlog/issues/630))

### Minor changes
- Backup retention now accepts `0` (disable that tier — no file written, no promotion) and `1` (rolling latest — overwrite on each run) for `BACKUP_RETENTION_DAILY`, `_WEEKLY`, and `_MONTHLY`. `DAILY=0` with `WEEKLY>0` or `MONTHLY>0` is rejected at startup since weekly and monthly hardlink from the daily file. Runtime UI editing is tracked in #683. ([#682](https://github.com/brlauuu/podlog/issues/682))
- Ask page and episode chat answers now render as Markdown. Bold, lists, headers, and links in model responses (e.g. from Gemma 4) are displayed properly. The RAG system prompt now instructs models to use Markdown formatting. ([#638](https://github.com/brlauuu/podlog/issues/638))
- Audio file size tag on the episode page and podcast episode cards. Shows the size of the file actually processed by transcription (the 16 kHz mono WAV for local Whisper, the raw download for Fireworks). Existing episodes show no tag until a backfill is run. ([#634](https://github.com/brlauuu/podlog/issues/634))
- Copy-to-clipboard button for the episode UUID on the episode page. Subtle icon next to the title. ([#601](https://github.com/brlauuu/podlog/pull/601))
- "Releases" sidebar on `/about` (right rail, `xl:` and up) listing every changelog version with sticky scroll-spy. Header shows version count and the latest tagged release. ([#606](https://github.com/brlauuu/podlog/pull/606))
- Episode page tag strip now shows the same metadata tags as the episode card on the podcast page: language (with flag), Local/Remote inference provider, and a "No labels" warning when diarization didn't produce speaker labels. Speaker name tags remain on the card only. ([#609](https://github.com/brlauuu/podlog/issues/609))
- Settings → Remote Inference now links out to the Fireworks dashboard from both the API key field ("Generate at fireworks.ai/account/api-keys") and the "What are remote inference providers?" explainer, mirroring the existing pyannote.ai dashboard links. ([#618](https://github.com/brlauuu/podlog/issues/618))
- `/about` page layout now matches the docs page: centered content with a sticky right-rail TOC ("On this page") that lists two top-level entries (**About**, **Changelog**) and version numbers nested under Changelog. Clicking a version number jumps to that section heading. Replaces the previous flat "Releases" sidebar. ([#620](https://github.com/brlauuu/podlog/issues/620))
- Optional Jupyter-based DB exploration service (advanced). Opt-in via `make explore` (Compose profile `explore`); ships with JupyterLab, pandas, numpy, plotly, sqlalchemy preinstalled and a starter notebook (`notebooks/examples/01_explore_db.ipynb`) demonstrating schema dump + sample queries + Plotly chart. Notebooks persist on the host at `notebooks/`; only the `examples/` directory is checked in. UI status panel ships in a follow-up PR. ([#607](https://github.com/brlauuu/podlog/issues/607))
- Subtle status indicator for the explore service at the bottom of the Meta-Analysis page. When the container is running, links to the Jupyter URL with a token-fetch hint; when not running, links to the explore guide in the docs. No start/stop UI controls — managed via `make explore` from the CLI by design. ([#607](https://github.com/brlauuu/podlog/issues/607))

### Minor changes
- Settings page gains a Backups tab listing the available DB dumps (daily/weekly/monthly) and audio snapshots with their dates and sizes, plus the last-run flag and current retention. Read-only — restore is still via `make restore-db DATE=...` / `make restore-audio DATE=...`. Backed by a new pipeline `/api/backups` endpoint that reads the `./backups/` directory mounted read-only into the pipeline container. ([#646](https://github.com/brlauuu/podlog/issues/646))

### Fixes
- Manual upload retry no longer fails with `Invalid IDNA hostname` when the original filename had non-ASCII characters. The retry endpoint always queued a fresh `download` job, which fed the synthetic `local://<filename>` URL back into httpx — non-ASCII filenames tripped its IDNA encoding. `enqueue_episode_ingest` now detects manually-uploaded episodes (rows with a `local://` URL and an existing on-disk file) and starts them at `transcribe`, mirroring the original upload path. If the on-disk file is gone (host reboot, unrestored audio, manual purge), `download` short-circuits with a dedicated `MANUAL_UPLOAD_FILE_MISSING` terminal failure that says "re-upload the file" instead of an opaque protocol error. ([#650](https://github.com/brlauuu/podlog/issues/650))
- Fireworks transcription HTTP errors now include the API response body. Previously a 4xx from Fireworks surfaced as `Fireworks API HTTP 400` with no actionable detail; the failure notification and queue-page error message now read `Fireworks API HTTP 400: <reason>` (truncated to 500 chars), parsing the OpenAI-compatible `{"error": {"message": ...}}` shape with fallback to plain text. ([#650](https://github.com/brlauuu/podlog/issues/650))
- Right-rail TOC links on the About page now scroll to the right release. The version headings (`## [0.3.0] — ...`) used markdown reference-link syntax, which made react-markdown render `[0.3.0]` as an anchor pointing to a non-resolvable GitHub compare URL and caused the rendered heading text to drift from the slug used by the TOC, leaving each `<h2>` with no `id`. Reference-link syntax is dropped from version headings (`## 0.3.0 — ...`), the broken compare-URL link defs at the bottom of the file are removed, and the About page version filter is updated to match the new format. ([#644](https://github.com/brlauuu/podlog/issues/644))
- Curated Fireworks chat models in Settings → Remote Inference → RAG / Ask refreshed. The previous picks (`qwen2p5-7b-instruct`, `llama-v3p1-70b-instruct`, `qwen2p5-72b-instruct`) all returned 404 from Fireworks's serverless endpoint, and the obvious next-generation replacements (`qwen3-8b`, `llama-v3p3-70b-instruct`, `deepseek-v3p1`) were announced as obsolete in a May 2026 Fireworks deprecation notice. Curated trio now follows Fireworks's stated migration targets: `gpt-oss-20b` (Fast), `gpt-oss-120b` (Balanced), `glm-5p1` (Quality). Default `FIREWORKS_CHAT_MODEL` follows. Existing installs with the env var or stored setting set explicitly keep their value. ([#636](https://github.com/brlauuu/podlog/issues/636))
- Local RAG model selection in Settings → Remote Inference now works. Picking a model from the RAG / Ask step's dropdown persists the choice as `rag_local_model`; the Ask page and episode chat use this as the default when no per-session selection has been made. ([#637](https://github.com/brlauuu/podlog/issues/637))
- Transient errors in `embed`, `chunk`, `infer`, `archive` no longer strand episodes mid-pipeline. The worker loop now classifies any exception that escapes a task — network errors, DNS failures, connection resets, timeouts, and equivalent-by-message OS errors — as transient and re-enqueues the same task with exponential backoff, up to `retry_max=3` attempts. Non-transient errors mark the episode `failed` with `SYSTEM_ERROR` instead of leaving it stuck in a status like `embedding`. `download` and `transcribe` continue to handle their own errors internally so the worker-level path is dormant for them — the duplication can be cleaned up in a follow-up. A new `recover_stranded_episodes` periodic task (every 30 min) acts as a safety net: it finds any episode in a non-terminal status with no active job and re-enqueues it at the right stage. ([#641](https://github.com/brlauuu/podlog/issues/641))
- `FIREWORKS_UPLOAD_REJECTED` is now retryable. The TLS-abort signature (`BAD_RECORD_MAC`) was originally classified as non-retryable on the assumption it indicated a hard size/duration cap (#600). Bulk-reprocessing data showed it's actually transient (~14% per-attempt failure rate at any episode size, ~99% recovery on retry), so the standard `retry_max` budget now applies. Episodes only land in `failed` after retries are exhausted; the failure notification copy is updated to reflect this. ([#641](https://github.com/brlauuu/podlog/issues/641))
- About page content column now aligns horizontally with the Docs page. Mirrors Docs's 3-column `[nav | content | toc]` grid at xl, with an empty placeholder where Docs has its left nav, so switching tabs no longer shifts the text. ([#620](https://github.com/brlauuu/podlog/issues/620))
- Cost-tag tooltips on the episode page (Fireworks STT, pyannote cloud) had a transparent background — caused by a `bg-popover` Tailwind class whose `--popover` CSS variable is not defined in `globals.css`. Switched to the defined `bg-card` / `text-card-foreground`. Same fix applied to the duplicate tooltips on podcast-page episode cards.
- Default `FIREWORKS_CHAT_MODEL` updated from `accounts/fireworks/models/llama-v3p1-8b-instruct` (deprecated by Fireworks, would 404 out of the box) to `accounts/fireworks/models/qwen2p5-7b-instruct`. Aligned with the curated Ask-page dropdown. Existing installs with the env var set explicitly keep their value. ([#608](https://github.com/brlauuu/podlog/issues/608))
- Archive task now captures the tail of `ffmpeg`'s stderr when compression fails, instead of storing the placeholder `"ffmpeg error (see stderr output for detail)"`. ([#603](https://github.com/brlauuu/podlog/pull/603))
- CI Slow's web e2e job now runs `alembic upgrade head` against `db_test` before serving, fixing the `relation "feeds" does not exist` failure introduced when the SSR e2e specs landed. (commit `21629cb`)

### Internal
- Consolidated retry logic into the worker loop. `download.py` and `transcribe.py` no longer carry their own `_handle_transient_failure` helpers, retry-budget bookkeeping, or wrapping `try/except` blocks for network / HTTP / Fireworks errors — those now propagate to the worker's `_classify_for_retry`, which extends issue #641's classifier with three new branches: typed exceptions carrying `retryable: bool` + `error_class: str` (e.g. `FireworksTranscriptionError`) win and keep their semantic class; `MemoryError` is terminal `OOM`; `httpx.HTTPStatusError` 5xx/429 retries as `TRANSIENT_NETWORK`, 4xx is now **terminal** `HTTP_ACCESS` (small behavior change from the pre-#653 `download.py` which retried 4xx three times — a 404/403/410 isn't going to resolve on retry, so failing fast saves bandwidth and gives the user a clear signal). The terminal cases that genuinely deserve specific error classes (`DISK_FULL`, `MANUAL_UPLOAD_FILE_MISSING`) stay as per-task short-circuits. ~140 lines net deletion across the pipeline. ([#653](https://github.com/brlauuu/podlog/issues/653))
- Periodic cleanup task that prunes superseded `failed` rows in `job_queue` (rows whose episode later succeeded). Runs every 24 h; clears noise from the queue dashboard's "failed" counter. ([#604](https://github.com/brlauuu/podlog/pull/604))
- Decoupled Ask/RAG generation from `inference_provider`: backend now reads a dedicated `rag_provider` runtime flag (default `local`). Previously, enabling Fireworks for transcription silently routed retrieved transcript chunks to Fireworks for answer generation too. Existing installs default to `local` so no behavior change on upgrade — Settings UI to change this ships in a follow-up PR. Also surfaces a clean, actionable message (instead of leaking the raw provider response) when Fireworks returns 404 for a deprecated chat model. ([#608](https://github.com/brlauuu/podlog/issues/608))
- New "Changelog" CI check fails any PR that doesn't touch `CHANGELOG.md`; opt out per-PR with the `no-changelog` label. ([#605](https://github.com/brlauuu/podlog/pull/605))

### Other minor changes
- Zod runtime validation for the settings response. ([#588](https://github.com/brlauuu/podlog/pull/588))
- Keyword search across docs. ([#589](https://github.com/brlauuu/podlog/pull/589))
- Filter podcast episodes list by speaker name. ([#593](https://github.com/brlauuu/podlog/pull/593))
- Format all dates as DD/MM/YYYY app-wide. ([#594](https://github.com/brlauuu/podlog/pull/594))

### Other fixes
- Remove "Large tiles" option from podcasts list. ([#585](https://github.com/brlauuu/podlog/pull/585))
- Surface unavailable audio in the player + add a recovery script. ([#586](https://github.com/brlauuu/podlog/pull/586))
- Exclude `tests/**` from base tsconfig so `tsc --noEmit` passes. ([#587](https://github.com/brlauuu/podlog/pull/587))

## 0.3.0 — 2026-04-24

### Major changes
- **pyannote.ai Precision-2 cloud diarization** as an alternative to local pyannote, selectable per environment via `DIARIZATION_PROVIDER=precision2`. Includes a settings UI, per-episode cost capture (`pyannote_cloud_cost_usd`), and a new `RISK-11` write-up. ([#541](https://github.com/brlauuu/podlog/pull/541), [#542](https://github.com/brlauuu/podlog/pull/542), [#543](https://github.com/brlauuu/podlog/pull/543), [#544](https://github.com/brlauuu/podlog/pull/544))

### Internal
- Inference service split into focused modules; queue read path moved to pipeline API. ([#577](https://github.com/brlauuu/podlog/pull/577), [#578](https://github.com/brlauuu/podlog/pull/578))
- Recharts upgraded 2 → 3. ([#575](https://github.com/brlauuu/podlog/pull/575))
- New e2e coverage for queue, meta-analysis, Ask AI, and SSR pages. ([#582](https://github.com/brlauuu/podlog/pull/582), [#583](https://github.com/brlauuu/podlog/pull/583))

### Other fixes
- Center text in Search and Ask search bars. ([#584](https://github.com/brlauuu/podlog/pull/584))

### Docs
- Refresh CLAUDE.md repo structure + current state. ([#557](https://github.com/brlauuu/podlog/pull/557))
- Refresh README versions + Meta-Analysis feature. ([#558](https://github.com/brlauuu/podlog/pull/558))
- Sync dev guide + user guide with current codebase. ([#559](https://github.com/brlauuu/podlog/pull/559))
- Reflect shipped features in PRD roadmaps. ([#560](https://github.com/brlauuu/podlog/pull/560))

### Tests
- Cover low-coverage pipeline modules. ([#563](https://github.com/brlauuu/podlog/pull/563))
- Cover meta-analysis + pipeline/ask API routes. ([#568](https://github.com/brlauuu/podlog/pull/568))
- Cover lib helpers (db, filterOpts, mentions, grouped). ([#570](https://github.com/brlauuu/podlog/pull/570))
- Cover simple UI components. ([#571](https://github.com/brlauuu/podlog/pull/571))
- Cover meta-analysis chart transforms + render smoke. ([#572](https://github.com/brlauuu/podlog/pull/572))
- Cover EpisodeChat UI states and submit error paths. ([#573](https://github.com/brlauuu/podlog/pull/573))

### Other internal
- Remove orphan nightly-audit script. ([#561](https://github.com/brlauuu/podlog/pull/561))
- Remove unused web params, imports, and props. ([#562](https://github.com/brlauuu/podlog/pull/562))
- Bump web patch/minor deps. ([#574](https://github.com/brlauuu/podlog/pull/574))

## 0.2.0 — 2026-04-24

### Major changes
- **Meta-Analysis dashboard** at `/meta-analysis`. Cross-feed metrics — episode counts, durations, words-per-minute, turn density, host/guest share, processing time, token and cost totals — with drill-down charts. ([#538](https://github.com/brlauuu/podlog/pull/538))

## 0.1.3 — 2026-04-20

### Major changes
- **Gemma 4 e4b** model option for the Ask AI feature, with per-model `num_ctx` so each model can use its full context window. ([#519](https://github.com/brlauuu/podlog/pull/519))

### Minor changes
- Provider-scoped notification averages and per-episode processing factor — averages no longer mix local and remote runs. ([#522](https://github.com/brlauuu/podlog/pull/522))

### Fixes
- Ask AI now recovers gracefully from Ollama memory-cap OOMs (unloads cached models and retries once). ([#520](https://github.com/brlauuu/podlog/pull/520))
- Pipeline boots cleanly under torchaudio 2.8 — pyannote audio-loading restored. ([#447](https://github.com/brlauuu/podlog/pull/447))

## 0.1.2 — 2026-04-20

### Major changes
- **Upgrade pyannote diarization to community-1** (from `speaker-diarization-3.1`). Requires a fresh model download on first run. ([#517](https://github.com/brlauuu/podlog/pull/517))
- **Host/guest speaker name inference** (PRD-04) now ships end to end: ships `en_core_web_trf` by default, parses RSS `<podcast:person>` tags, applies an episode-title heuristic, a recurring-host rule, and a per-feed speaker name cache so renames carry across episodes in the same feed. ([#525](https://github.com/brlauuu/podlog/pull/525), [#526](https://github.com/brlauuu/podlog/pull/526), [#527](https://github.com/brlauuu/podlog/pull/527), [#529](https://github.com/brlauuu/podlog/pull/529), [#531](https://github.com/brlauuu/podlog/pull/531))

### Fixes
- `feed_speaker_cache` UUID inserts no longer cast to text, fixing pipeline boot under PostgreSQL 15. ([#532](https://github.com/brlauuu/podlog/pull/532))
- Confidence reconciliation in `merge_candidates` no longer demotes high-confidence inferences. ([#534](https://github.com/brlauuu/podlog/pull/534))
- `PYANNOTE_MODEL` resolves the correct repo id, with an actionable error message when HF auth is missing. ([#539](https://github.com/brlauuu/podlog/pull/539))

### Other minor changes
- Add Explore button to landing page. ([#535](https://github.com/brlauuu/podlog/pull/535))

### Other fixes
- Preserve unicode characters in export filenames. ([#540](https://github.com/brlauuu/podlog/pull/540))

## 0.1.1 — 2026-04-07

### Major changes
- **Fireworks AI remote-inference profile** — opt-in alternative to local processing for users who can't or don't want to run Whisper, pyannote, or Ollama locally. Covers transcription/diarization, embeddings, Ask AI generation, retries, observability (latency + cost), and a `docker-compose.remote.yml` overlay. ([#256](https://github.com/brlauuu/podlog/pull/256), [#262](https://github.com/brlauuu/podlog/pull/262), [#263](https://github.com/brlauuu/podlog/pull/263), [#265](https://github.com/brlauuu/podlog/pull/265), [#267](https://github.com/brlauuu/podlog/pull/267), [#268](https://github.com/brlauuu/podlog/pull/268))
- **Manual upload path in first-run onboarding** — start without an RSS feed at all. ([#312](https://github.com/brlauuu/podlog/pull/312))
- **Settings page redesign** with notifications and remote-inference sections, two-tab layout, per-tab save buttons. ([#343](https://github.com/brlauuu/podlog/pull/343), [#382](https://github.com/brlauuu/podlog/pull/382))
- **Speaker filter for search and Ask** — restrict results to specific speakers. ([#353](https://github.com/brlauuu/podlog/pull/353))
- **Scoped search** for title / description / speaker with metadata-only mode and pagination. ([#365](https://github.com/brlauuu/podlog/pull/365), [#366](https://github.com/brlauuu/podlog/pull/366))
- **In-app docs tab** with markdown navigation, replacing the first-run wizard's standalone help. ([#361](https://github.com/brlauuu/podlog/pull/361), [#385](https://github.com/brlauuu/podlog/pull/385), [#438](https://github.com/brlauuu/podlog/pull/438), [#444](https://github.com/brlauuu/podlog/pull/444))
- **Episode-scoped Ask AI chat** — ask questions against a single episode and get word-level citations. ([#202](https://github.com/brlauuu/podlog/pull/202), [#460](https://github.com/brlauuu/podlog/pull/460))
- **Per-step diarization timing breakdowns** — see exactly where pyannote is spending its time on each episode. ([#352](https://github.com/brlauuu/podlog/pull/352))
- **MP4 audio uploads**, modal upload + search + rich cards on the Sources page, delete button for manual uploads. ([#443](https://github.com/brlauuu/podlog/pull/443), [#458](https://github.com/brlauuu/podlog/pull/458), [#461](https://github.com/brlauuu/podlog/pull/461))
- **Selective feeds: add more episodes** to a feed already in selective mode without re-onboarding it. ([#513](https://github.com/brlauuu/podlog/pull/513))

### Minor changes
- Markdown and PDF export options on episode pages. ([#255](https://github.com/brlauuu/podlog/pull/255))
- Theme-aware logos and unified search bar across Search and Ask. ([#296](https://github.com/brlauuu/podlog/pull/296), [#332](https://github.com/brlauuu/podlog/pull/332))
- Episode-card redesign with tag-based metadata strip; provider tag colors set to violet/teal. ([#362](https://github.com/brlauuu/podlog/pull/362), [#380](https://github.com/brlauuu/podlog/pull/380), [#409](https://github.com/brlauuu/podlog/pull/409))
- Source-page header gets podcast image, website, and description. ([#431](https://github.com/brlauuu/podlog/pull/431))
- View-mode toggle (list/grid/large tiles) on the Sources page. ([#514](https://github.com/brlauuu/podlog/pull/514))
- About page rewrite, refreshed README/docs to match shipped behavior. ([#407](https://github.com/brlauuu/podlog/pull/407), [#446](https://github.com/brlauuu/podlog/pull/446))

### Fixes
- Fireworks segments rebuilt from word-level speaker data and split at sentence boundaries — closer parity with the local provider. ([#354](https://github.com/brlauuu/podlog/pull/354), [#359](https://github.com/brlauuu/podlog/pull/359))
- Reprocessing an episode now resets `inference_provider_used`, so a remote → local switch is reflected in the next run. ([#437](https://github.com/brlauuu/podlog/pull/437))
- Archive no longer deletes the archive file when re-running archive on an already-compressed file. ([#449](https://github.com/brlauuu/podlog/pull/449))
- Ask SSE proxy no longer crashes on client disconnect. ([#450](https://github.com/brlauuu/podlog/pull/450))
- Ask scoped to a single episode skips the similarity threshold so short episodes still surface citations. ([#452](https://github.com/brlauuu/podlog/pull/452))
- Episode page back-to-search link, prev/next nav arrows, and tag chip heights — many small alignment fixes. ([#389](https://github.com/brlauuu/podlog/pull/389), [#390](https://github.com/brlauuu/podlog/pull/390), [#401](https://github.com/brlauuu/podlog/pull/401), [#408](https://github.com/brlauuu/podlog/pull/408), [#411](https://github.com/brlauuu/podlog/pull/411))
- Filter loading and confirmed-speaker sourcing on search no longer race. ([#410](https://github.com/brlauuu/podlog/pull/410))
- Popovers, dropdowns, and selects are opaque (was: see-through over content). ([#428](https://github.com/brlauuu/podlog/pull/428))
- Worker startup validates the task registry and fails loudly if a handler reference is broken. ([#297](https://github.com/brlauuu/podlog/pull/297))

### Internal
- React 18 → 19, Next.js 14 → 16, Tailwind 3 → 4, ESLint 8 → 9, TypeScript 5.x → 6.0, jest 29 → 30. ([#213](https://github.com/brlauuu/podlog/pull/213), [#224](https://github.com/brlauuu/podlog/pull/224), [#226](https://github.com/brlauuu/podlog/pull/226), [#229](https://github.com/brlauuu/podlog/pull/229), [#503](https://github.com/brlauuu/podlog/pull/503))
- Pipeline API split from worker task wiring; web search library, settings UI, feeds page, and notification settings extracted into focused modules. ([#341](https://github.com/brlauuu/podlog/pull/341), [#342](https://github.com/brlauuu/podlog/pull/342), [#417](https://github.com/brlauuu/podlog/pull/417)–[#422](https://github.com/brlauuu/podlog/pull/422), [#427](https://github.com/brlauuu/podlog/pull/427)–[#433](https://github.com/brlauuu/podlog/pull/433))
- CI enforces test coverage thresholds (pipeline 82%, web via `coverageThreshold`). ([#483](https://github.com/brlauuu/podlog/pull/483))
- "Operational Gotchas" section added to `CLAUDE.md` so issues like the UUID cast that bit us in #532 don't repeat. ([#533](https://github.com/brlauuu/podlog/pull/533))

### Other minor changes
- Upgrade landing page branding and CTA. ([#292](https://github.com/brlauuu/podlog/pull/292))
- Persist Ask/Search state across navigation. ([#293](https://github.com/brlauuu/podlog/pull/293))
- Stabilize Ask layout and add help popover. ([#295](https://github.com/brlauuu/podlog/pull/295))
- Declare numpy as a direct Poetry dependency. ([#299](https://github.com/brlauuu/podlog/pull/299))
- Integrate healthcheck tests into the supported unit-test layout. ([#300](https://github.com/brlauuu/podlog/pull/300))
- Refresh CLAUDE.md to match current repo state. ([#301](https://github.com/brlauuu/podlog/pull/301))
- Prune unused dependencies and exports. ([#305](https://github.com/brlauuu/podlog/pull/305))
- Add copyright disclaimer to README and About page. ([#317](https://github.com/brlauuu/podlog/pull/317))
- Center landing page hero block in viewport. ([#331](https://github.com/brlauuu/podlog/pull/331))
- Monochrome action system + centralized action color. ([#333](https://github.com/brlauuu/podlog/pull/333))
- Improve UI of episodes page. ([#363](https://github.com/brlauuu/podlog/pull/363))
- UI fix for episode page navigation. ([#364](https://github.com/brlauuu/podlog/pull/364))
- Update README credits with linked agents and platforms. ([#383](https://github.com/brlauuu/podlog/pull/383))
- UI tag and inference label adjustments on podcast episodes. ([#388](https://github.com/brlauuu/podlog/pull/388))
- Remove episode count from Ask page help hover. ([#400](https://github.com/brlauuu/podlog/pull/400))
- Update About-page credits to match README format. ([#406](https://github.com/brlauuu/podlog/pull/406))
- Revert About page to `max-w-2xl` width. ([#435](https://github.com/brlauuu/podlog/pull/435))
- Remove width cap on docs page to maximise content column. ([#442](https://github.com/brlauuu/podlog/pull/442))
- Match "Manage feeds" button styling to "Upload audio". ([#462](https://github.com/brlauuu/podlog/pull/462))
- Compact Sources section buttons + podcast count. ([#464](https://github.com/brlauuu/podlog/pull/464))

### Other fixes
- Episode nav placement and help dropdown opacity. ([#247](https://github.com/brlauuu/podlog/pull/247))
- Wizard dismiss on step-2 skip; tests aligned. ([#253](https://github.com/brlauuu/podlog/pull/253))
- Skip archive compression when source is already in the archive directory. ([#266](https://github.com/brlauuu/podlog/pull/266))
- Ask "source play" action now starts embedded audio. ([#294](https://github.com/brlauuu/podlog/pull/294))
- Standardize Ask timestamp deep-links. ([#303](https://github.com/brlauuu/podlog/pull/303))
- Repair pipeline container test harness. ([#308](https://github.com/brlauuu/podlog/pull/308))
- Spinner layout shift on Search and Ask. ([#316](https://github.com/brlauuu/podlog/pull/316))
- Wizard skip/completion navigation regressions. ([#336](https://github.com/brlauuu/podlog/pull/336))
- Selective-episodes dialog overflow and speaker-click re-scroll. ([#348](https://github.com/brlauuu/podlog/pull/348))
- Speaker tags on podcast episode list. ([#379](https://github.com/brlauuu/podlog/pull/379))
- Docs tab markdown link resolution. ([#381](https://github.com/brlauuu/podlog/pull/381))
- Inference tags now render with the requested colors. ([#397](https://github.com/brlauuu/podlog/pull/397))
- Load the `/docs` listing at runtime. ([#404](https://github.com/brlauuu/podlog/pull/404))
- Explicit speaker actions and direct inferred-name confirmation. ([#405](https://github.com/brlauuu/podlog/pull/405))
- Stabilize Node runtime checks and outdated-package workflow. ([#413](https://github.com/brlauuu/podlog/pull/413))
- About page spans content full width. ([#434](https://github.com/brlauuu/podlog/pull/434))
- Align docs TOC with navbar edge and stretch content. ([#440](https://github.com/brlauuu/podlog/pull/440))
- Float episode Ask button above audio player. ([#451](https://github.com/brlauuu/podlog/pull/451))
- Stack floating buttons above audio player (follow-up to #448). ([#453](https://github.com/brlauuu/podlog/pull/453))
- Serialize feed `id` as text in `GET /api/feeds`. ([#456](https://github.com/brlauuu/podlog/pull/456))
- Raise Ask download dropdown above chat panel. ([#463](https://github.com/brlauuu/podlog/pull/463))

### Docs
- Fix RAG, lifecycle, and health-check config accuracy. ([#251](https://github.com/brlauuu/podlog/pull/251))
- Refresh stale search paths and test count references. ([#252](https://github.com/brlauuu/podlog/pull/252))
- Clarify audit workflows and findings lifecycle. ([#254](https://github.com/brlauuu/podlog/pull/254))
- Refresh README/docs freshness on latest main. ([#269](https://github.com/brlauuu/podlog/pull/269))
- Sync routes and Ask config. ([#306](https://github.com/brlauuu/podlog/pull/306))
- Align CLAUDE.md claims with current codebase. ([#334](https://github.com/brlauuu/podlog/pull/334))
- Align stage/status docs and make `test-unit` scope match reality. ([#335](https://github.com/brlauuu/podlog/pull/335))
- Fix CLAUDE and audit-spec stale claims. ([#415](https://github.com/brlauuu/podlog/pull/415))
- Deprecate obsolete worker-splitting spec. ([#416](https://github.com/brlauuu/podlog/pull/416))
- Update CLAUDE.md and fix stale documentation. ([#482](https://github.com/brlauuu/podlog/pull/482))
- Fix PRD/CLAUDE.md drift. ([#500](https://github.com/brlauuu/podlog/pull/500))

### Tests
- Improve coverage for audio player context. ([#249](https://github.com/brlauuu/podlog/pull/249))
- Wizard regression coverage. ([#307](https://github.com/brlauuu/podlog/pull/307))
- Targeted pipeline coverage for failure paths. ([#309](https://github.com/brlauuu/podlog/pull/309))
- Restore runnable Playwright e2e setup. ([#310](https://github.com/brlauuu/podlog/pull/310))
- Use full web coverage denominator. ([#311](https://github.com/brlauuu/podlog/pull/311))
- Targeted coverage for queue/search/speaker and pipeline embed flows. ([#339](https://github.com/brlauuu/podlog/pull/339))
- Fix CI failures from pyannote soundfile import and Ask floating button. ([#465](https://github.com/brlauuu/podlog/pull/465))
- Fix integration tests for CI Slow. ([#466](https://github.com/brlauuu/podlog/pull/466))
- Cover audio route with full handler tests. ([#505](https://github.com/brlauuu/podlog/pull/505))
- Cover 5 zero-coverage proxy API routes. ([#506](https://github.com/brlauuu/podlog/pull/506))
- Cover 6 more zero-coverage proxy routes. ([#507](https://github.com/brlauuu/podlog/pull/507))
- Cover `api/queue` route. ([#508](https://github.com/brlauuu/podlog/pull/508))
- Cover episode mutation routes incl. transactional merge. ([#509](https://github.com/brlauuu/podlog/pull/509))
- Cover simple components, pages, and grouping helper. ([#510](https://github.com/brlauuu/podlog/pull/510))
- Cover FeedCard and FeedsListSection. ([#511](https://github.com/brlauuu/podlog/pull/511))
- Split long test files per scenario. ([#512](https://github.com/brlauuu/podlog/pull/512))

### Other internal
- Clean dead code and wire healthcheck tests. ([#250](https://github.com/brlauuu/podlog/pull/250))
- Add minimal GitHub Actions workflow for test freshness. ([#270](https://github.com/brlauuu/podlog/pull/270))
- Refactor notification runtime/event modules and split settings UI. ([#313](https://github.com/brlauuu/podlog/pull/313))
- Refactor search and queue logic boundaries. ([#314](https://github.com/brlauuu/podlog/pull/314))
- Align local Node requirements with Next.js 16. ([#337](https://github.com/brlauuu/podlog/pull/337))
- Remove dead stubs and unused exports. ([#338](https://github.com/brlauuu/podlog/pull/338))
- Remove orphan CSS declaration and redundant UI exports. ([#414](https://github.com/brlauuu/podlog/pull/414))
- Extract FeedCard from feeds page. ([#418](https://github.com/brlauuu/podlog/pull/418))
- Extract NotificationSection cards. ([#419](https://github.com/brlauuu/podlog/pull/419))
- Extract RemoteInferenceSection parts. ([#420](https://github.com/brlauuu/podlog/pull/420))
- Extract top controls from search page. ([#421](https://github.com/brlauuu/podlog/pull/421))
- Extract inference text helpers. ([#429](https://github.com/brlauuu/podlog/pull/429))
- Extract digest formatter helpers. ([#430](https://github.com/brlauuu/podlog/pull/430))
- Split search page pagination and empty state. ([#432](https://github.com/brlauuu/podlog/pull/432))
- Remove orphaned wizard/help-menu dead code and unused test fixtures. ([#480](https://github.com/brlauuu/podlog/pull/480))
- Remove orphaned root `package-lock.json`. ([#481](https://github.com/brlauuu/podlog/pull/481))
- Extract shared search filter builders from `search.ts`. ([#484](https://github.com/brlauuu/podlog/pull/484))
- Extract task registry from `worker.py`. ([#485](https://github.com/brlauuu/podlog/pull/485))
- Un-export page-state snapshot types. ([#501](https://github.com/brlauuu/podlog/pull/501))
- Bump minor/patch npm deps. ([#502](https://github.com/brlauuu/podlog/pull/502))
- Split `search.ts` into per-function modules. ([#504](https://github.com/brlauuu/podlog/pull/504))

## 0.1.0 — 2026-04-04

### Major changes
- **Versioning system** introduced — single-source `VERSION` file at the repo root, surfaced in the navbar/About page. ([#162](https://github.com/brlauuu/podlog/pull/162))
- **Ask AI (RAG)** — natural-language Q&A over the transcript library, citation-backed and streamed. Ollama by default, Fireworks AI optional. Includes the `/api/ask` SSE endpoint, the `/ask` UI, episode-feed-filtered citations, and the segment-chunking pipeline step that feeds it. ([#124](https://github.com/brlauuu/podlog/pull/124), [#133](https://github.com/brlauuu/podlog/pull/133), [#134](https://github.com/brlauuu/podlog/pull/134), [#135](https://github.com/brlauuu/podlog/pull/135), [#137](https://github.com/brlauuu/podlog/pull/137), [#176](https://github.com/brlauuu/podlog/pull/176), [#202](https://github.com/brlauuu/podlog/pull/202))
- **Drag-and-drop audio upload** path on the web UI. ([#166](https://github.com/brlauuu/podlog/pull/166))
- **Backfill task** for embedding existing segments + progress tracking, so older episodes become Ask-able. ([#163](https://github.com/brlauuu/podlog/pull/163))
- **Search results show full speaker segments** (not just the matched line). ([#183](https://github.com/brlauuu/podlog/pull/183))
- **Reprocess button** on episode pages — wipe and re-run an episode without dropping the row. ([#74](https://github.com/brlauuu/podlog/pull/74))
- **Speaker filter on episode page** + back-to-top button. ([#209](https://github.com/brlauuu/podlog/pull/209))
- **Home page** with a clear search/ask split; landing page cleanup. ([#203](https://github.com/brlauuu/podlog/pull/203), [#208](https://github.com/brlauuu/podlog/pull/208))
- **Health check UI toggle** + Telegram alert refinements. ([#160](https://github.com/brlauuu/podlog/pull/160))
- **Sources renamed from Podcasts**, with an Uploads section. ([#178](https://github.com/brlauuu/podlog/pull/178))

### Minor changes
- Persistent audio player gets a close button and conditional bottom padding. ([#207](https://github.com/brlauuu/podlog/pull/207))
- Prev/next episode navigation. ([#175](https://github.com/brlauuu/podlog/pull/175))
- Footer simplified, About page added, system status moved to a help menu. ([#212](https://github.com/brlauuu/podlog/pull/212))
- Processing-status pill on episodes; unprocessed episodes excluded from search results. ([#165](https://github.com/brlauuu/podlog/pull/165))

### Fixes
- Allow reprocessing of `done` episodes; allow retrying stuck/orphaned episodes. ([#173](https://github.com/brlauuu/podlog/pull/173), [#179](https://github.com/brlauuu/podlog/pull/179))
- Convert non-WAV audio to WAV before diarization (fixes pyannote OOM on certain inputs). ([#177](https://github.com/brlauuu/podlog/pull/177))
- Vector cast syntax error on Ask page. ([#180](https://github.com/brlauuu/podlog/pull/180))
- Improved Ask page error handling for Ollama failures. ([#184](https://github.com/brlauuu/podlog/pull/184))
- Notification download failures normalized; channels properly isolated. ([#119](https://github.com/brlauuu/podlog/pull/119), [#131](https://github.com/brlauuu/podlog/pull/131))
- Audio route contract tightened (path traversal protection). ([#128](https://github.com/brlauuu/podlog/pull/128))
- Feedless episodes included in search results. ([#129](https://github.com/brlauuu/podlog/pull/129))
- Wizard UX bugs — close button, Get Started navigation, test-mode color, skip-to-completion flow. ([#153](https://github.com/brlauuu/podlog/pull/153), [#196](https://github.com/brlauuu/podlog/pull/196), [#302](https://github.com/brlauuu/podlog/pull/302), [#304](https://github.com/brlauuu/podlog/pull/304))

### Other minor changes
- UI tweaks — prominent titles, navbar About, inline search tips. ([#221](https://github.com/brlauuu/podlog/pull/221))
- Add avg episode length and processing factor to notifications. ([#230](https://github.com/brlauuu/podlog/pull/230))

### Other fixes
- Add missing `notification_log` migration. ([#126](https://github.com/brlauuu/podlog/pull/126))
- Repair test harness env vars and broken service. ([#127](https://github.com/brlauuu/podlog/pull/127))
- Type annotations, status comment, and embedding status tracking. ([#132](https://github.com/brlauuu/podlog/pull/132))
- Correct failing web tests for path traversal and grouped search. ([#148](https://github.com/brlauuu/podlog/pull/148))
- Add `torchaudio` as an explicit dependency. ([#155](https://github.com/brlauuu/podlog/pull/155))
- Resolve remaining #104 review findings (notifications + test stack). ([#164](https://github.com/brlauuu/podlog/pull/164))
- Fix episode page navigation ordering. ([#231](https://github.com/brlauuu/podlog/pull/231))
- Fix PRD staleness in PRD-02 and PRD-04. ([#241](https://github.com/brlauuu/podlog/pull/241))
- Fix PIPELINE_API vs PIPELINE_API_URL inconsistency. ([#242](https://github.com/brlauuu/podlog/pull/242))
- Fix wizard accessibility and API compliance gaps. ([#243](https://github.com/brlauuu/podlog/pull/243))

### Docs
- Update stale CLAUDE.md to current reality. ([#130](https://github.com/brlauuu/podlog/pull/130))
- Update CLAUDE.md to match current codebase. ([#149](https://github.com/brlauuu/podlog/pull/149))
- Update all PRDs to match current codebase. ([#150](https://github.com/brlauuu/podlog/pull/150))
- Fix test counts and add missing Ollama service. ([#154](https://github.com/brlauuu/podlog/pull/154))
- Fix stale documentation across CLAUDE.md, README, PRDs, and guides. ([#195](https://github.com/brlauuu/podlog/pull/195))
- Document Codex and Claude audit workflows. ([#232](https://github.com/brlauuu/podlog/pull/232))
- CLAUDE.md accuracy sweep. ([#245](https://github.com/brlauuu/podlog/pull/245))

### Tests
- Add 62 pipeline unit tests for uncovered files. ([#159](https://github.com/brlauuu/podlog/pull/159))
- Improve coverage for episodes API, RAG service, WizardAddFeed. ([#200](https://github.com/brlauuu/podlog/pull/200))

### Other internal
- Remove unused `soundfile` dependency. ([#156](https://github.com/brlauuu/podlog/pull/156))
- npm cleanup — remove unused packages, bump `lucide-react` and `tailwind-merge`. ([#157](https://github.com/brlauuu/podlog/pull/157))
- Remove unused `@types/dompurify`, add explicit `pydantic` dep. ([#199](https://github.com/brlauuu/podlog/pull/199))
- Bump `@tanstack/react-query` floor to ^5.96.2. ([#227](https://github.com/brlauuu/podlog/pull/227))

## 0.0.0 — 2026-03-14 to 2026-04-03 (pre-versioning)

The pre-versioning era — initial scaffold and the bulk of foundational features. Not a single release; every notable user-facing addition during this window is bucketed here under one heading.

### Major changes
- **Initial pipeline**: WhisperX transcription with `large-v3-turbo`, pyannote `speaker-diarization-3.1` for diarization, word-level speaker alignment, segment persistence, manual retry. ([#16](https://github.com/brlauuu/podlog/pull/16), [#18](https://github.com/brlauuu/podlog/pull/18))
- **Web UI**: search page (full-text), episode page with audio player, queue dashboard, feed management, episodes list with sortable columns. ([#17](https://github.com/brlauuu/podlog/pull/17), [#20](https://github.com/brlauuu/podlog/pull/20), [#22](https://github.com/brlauuu/podlog/pull/22), [#31](https://github.com/brlauuu/podlog/pull/31), [#40](https://github.com/brlauuu/podlog/pull/40))
- **TEST podcast mode** — sample 5 episodes from a feed before committing to full ingestion. ([#28](https://github.com/brlauuu/podlog/pull/28))
- **Hybrid search**: full-text keyword + pgvector semantic similarity merged via Reciprocal Rank Fusion; websearch syntax (`"exact phrase"`, `OR`, `-exclude`); trigram fallback. ([#78](https://github.com/brlauuu/podlog/pull/78))
- **Episode-centric search** with dialogue context and rich export (markdown, plain text, PDF). ([#41](https://github.com/brlauuu/podlog/pull/41), [#72](https://github.com/brlauuu/podlog/pull/72), [#80](https://github.com/brlauuu/podlog/pull/80), [#81](https://github.com/brlauuu/podlog/pull/81))
- **Search results aggregated by speaker turn** instead of per-segment. ([#71](https://github.com/brlauuu/podlog/pull/71))
- **Queue dashboard improvements**: grouping by podcast/status/stage, Kanban board view, per-stage filtering. ([#40](https://github.com/brlauuu/podlog/pull/40), [#45](https://github.com/brlauuu/podlog/pull/45), [#70](https://github.com/brlauuu/podlog/pull/70), [#89](https://github.com/brlauuu/podlog/pull/89))
- **Notifications system** (event-driven): Telegram + email channels, per-episode done/failed events, frequency modes (immediate/daily/weekly digest), multi-recipient email with validation, processing-time stats inside the message. ([#93](https://github.com/brlauuu/podlog/pull/93), [#95](https://github.com/brlauuu/podlog/pull/95), [#106](https://github.com/brlauuu/podlog/pull/106), [#113](https://github.com/brlauuu/podlog/pull/113))
- **First-run setup wizard** to walk a fresh installation through configuration. ([#110](https://github.com/brlauuu/podlog/pull/110))
- **Host-level health monitoring** with Telegram alerts (catches issues outside the docker stack itself). ([#120](https://github.com/brlauuu/podlog/pull/120))
- **Speaker labels redesigned** as chat-style bubbles with a speaker panel; consecutive same-speaker labels collapse; speakers numbered by first appearance. ([#48](https://github.com/brlauuu/podlog/pull/48), [#49](https://github.com/brlauuu/podlog/pull/49), [#53](https://github.com/brlauuu/podlog/pull/53))
- **Episode descriptions** rendered as HTML, with clickable timestamp deep-links. ([#30](https://github.com/brlauuu/podlog/pull/30), [#42](https://github.com/brlauuu/podlog/pull/42))
- **Comprehensive user guide** added at `docs/guide`. ([#109](https://github.com/brlauuu/podlog/pull/109))

### Internal — major architectural simplification (Phase 0–4)
The early stack was inherited from a more complex design. PRs [#62](https://github.com/brlauuu/podlog/pull/62), [#63](https://github.com/brlauuu/podlog/pull/63), [#64](https://github.com/brlauuu/podlog/pull/64), [#65](https://github.com/brlauuu/podlog/pull/65) reduced operational overhead substantially:

- **Phase 0–1**: bug fixes and code deduplication.
- **Phase 2**: container consolidation (8 services → 5).
- **Phase 3**: replaced Celery + Redis with a PostgreSQL-backed job queue (concurrency=1 to prevent OOM on small machines).
- **Phase 4**: narrowed FastAPI to a control-plane role (web app reads the DB directly for search, calls the API only for state-changing ops).

### Fixes
- Audio player progress updates and seek controls. ([#83](https://github.com/brlauuu/podlog/pull/83))
- Avg processing time and queue ETA no longer inflated by queue wait time. ([#123](https://github.com/brlauuu/podlog/pull/123))
- Archive status persistence; safe deletion of raw audio after archive. ([#87](https://github.com/brlauuu/podlog/pull/87))
- `host.docker.internal` resolves on Linux for email notifications. ([#103](https://github.com/brlauuu/podlog/pull/103))
- Notification settings persist across page revisits. ([#100](https://github.com/brlauuu/podlog/pull/100))
- Healthcheck Telegram 400 Bad Request. ([#122](https://github.com/brlauuu/podlog/pull/122))
- Path-traversal protection on the audio route. ([#34](https://github.com/brlauuu/podlog/pull/34))

### Other minor changes
- Add processing duration tracking for transcribe and diarize tasks. ([#19](https://github.com/brlauuu/podlog/pull/19))
- Add landing page branding, footer, and O'Saasy license. ([#21](https://github.com/brlauuu/podlog/pull/21))
- Restyle footer and theme to match blog, add per-service health. ([#26](https://github.com/brlauuu/podlog/pull/26))
- Link `brlauuu` references to GitHub Pages blog. ([#29](https://github.com/brlauuu/podlog/pull/29))
- Preserve search query for back-navigation from episode page. ([#43](https://github.com/brlauuu/podlog/pull/43))
- Install spaCy model in pipeline Docker image. ([#50](https://github.com/brlauuu/podlog/pull/50))
- Link queue items to episode page. ([#75](https://github.com/brlauuu/podlog/pull/75))
- Skip `COUNT(*)` query on search page 2+. ([#76](https://github.com/brlauuu/podlog/pull/76))
- Episode selection when adding a feed; fix test-mode ordering. ([#86](https://github.com/brlauuu/podlog/pull/86))

### Other fixes
- Retry endpoint for stalled jobs. ([#52](https://github.com/brlauuu/podlog/pull/52))
- Loading feedback on the "Poll Now" button. ([#73](https://github.com/brlauuu/podlog/pull/73))
- Queue page reads `job_queue` for active/pending state. ([#99](https://github.com/brlauuu/podlog/pull/99))
- Notification processing total. ([#107](https://github.com/brlauuu/podlog/pull/107))

### Docs
- Rewrite README and add project documentation. ([#79](https://github.com/brlauuu/podlog/pull/79))
- Health-monitoring setup and `postgresql-client` prerequisite. ([#121](https://github.com/brlauuu/podlog/pull/121))

### Other internal
- Split Celery worker into heavy and light queues (later removed in Phase 3). ([#51](https://github.com/brlauuu/podlog/pull/51))
