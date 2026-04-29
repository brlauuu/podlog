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
under the appropriate `[Unreleased]` heading below. When a release is cut via
the `release` skill, `[Unreleased]` graduates to a dated version section and a
fresh empty `[Unreleased]` is left at the top.
-->

## [Unreleased]

### Major changes
- Per-active-provider queue ETA in notifications. The "Est. time left" line in episode notifications now uses the rate of episodes processed by whichever inference provider is currently configured, and tags the line with `(local)` or `(remote)` so the basis is visible. ([#595](https://github.com/brlauuu/podlog/pull/595))
- Distinct error class for Fireworks upload rejections. When Fireworks aborts an upload at the TLS layer (typically size/duration cap), the failure is classified as `FIREWORKS_UPLOAD_REJECTED`, the retry loop is skipped, and notifications carry an "Action required: re-run on local inference" call-to-action. ([#602](https://github.com/brlauuu/podlog/pull/602))

### Minor changes
- Copy-to-clipboard button for the episode UUID on the episode page. Subtle icon next to the title. ([#601](https://github.com/brlauuu/podlog/pull/601))

### Fixes
- Archive task now captures the tail of `ffmpeg`'s stderr when compression fails, instead of storing the placeholder `"ffmpeg error (see stderr output for detail)"`. ([#603](https://github.com/brlauuu/podlog/pull/603))
- CI Slow's web e2e job now runs `alembic upgrade head` against `db_test` before serving, fixing the `relation "feeds" does not exist` failure introduced when the SSR e2e specs landed. ([#594](https://github.com/brlauuu/podlog/pull/594) follow-up)

### Internal
- Periodic cleanup task that prunes superseded `failed` rows in `job_queue` (rows whose episode later succeeded). Runs every 24 h; clears noise from the queue dashboard's "failed" counter. ([#604](https://github.com/brlauuu/podlog/pull/604))

## [0.3.0] — 2026-04-24

### Major changes
- **pyannote.ai Precision-2 cloud diarization** as an alternative to local pyannote, selectable per environment via `DIARIZATION_PROVIDER=precision2`. Includes a settings UI, per-episode cost capture (`pyannote_cloud_cost_usd`), and a new `RISK-11` write-up. ([#541](https://github.com/brlauuu/podlog/pull/541), [#542](https://github.com/brlauuu/podlog/pull/542), [#543](https://github.com/brlauuu/podlog/pull/543), [#544](https://github.com/brlauuu/podlog/pull/544))

### Internal
- Inference service split into focused modules; queue read path moved to pipeline API. ([#577](https://github.com/brlauuu/podlog/pull/577), [#578](https://github.com/brlauuu/podlog/pull/578))
- Recharts upgraded 2 → 3. ([#575](https://github.com/brlauuu/podlog/pull/575))
- New e2e coverage for queue, meta-analysis, Ask AI, and SSR pages. ([#582](https://github.com/brlauuu/podlog/pull/582), [#583](https://github.com/brlauuu/podlog/pull/583))

## [0.2.0] — 2026-04-24

### Major changes
- **Meta-Analysis dashboard** at `/meta-analysis`. Cross-feed metrics — episode counts, durations, words-per-minute, turn density, host/guest share, processing time, token and cost totals — with drill-down charts. ([#538](https://github.com/brlauuu/podlog/pull/538))

## [0.1.3] — 2026-04-20

### Major changes
- **Gemma 4 e4b** model option for the Ask AI feature, with per-model `num_ctx` so each model can use its full context window. ([#519](https://github.com/brlauuu/podlog/pull/519))

### Minor changes
- Provider-scoped notification averages and per-episode processing factor — averages no longer mix local and remote runs. ([#522](https://github.com/brlauuu/podlog/pull/522))

### Fixes
- Ask AI now recovers gracefully from Ollama memory-cap OOMs (unloads cached models and retries once). ([#520](https://github.com/brlauuu/podlog/pull/520))
- Pipeline boots cleanly under torchaudio 2.8 — pyannote audio-loading restored. ([#447](https://github.com/brlauuu/podlog/pull/447))

## [0.1.2] — 2026-04-20

### Major changes
- **Upgrade pyannote diarization to community-1** (from `speaker-diarization-3.1`). Requires a fresh model download on first run. ([#517](https://github.com/brlauuu/podlog/pull/517))
- **Host/guest speaker name inference** (PRD-04) now ships end to end: ships `en_core_web_trf` by default, parses RSS `<podcast:person>` tags, applies an episode-title heuristic, a recurring-host rule, and a per-feed speaker name cache so renames carry across episodes in the same feed. ([#525](https://github.com/brlauuu/podlog/pull/525), [#526](https://github.com/brlauuu/podlog/pull/526), [#527](https://github.com/brlauuu/podlog/pull/527), [#529](https://github.com/brlauuu/podlog/pull/529), [#531](https://github.com/brlauuu/podlog/pull/531))

### Fixes
- `feed_speaker_cache` UUID inserts no longer cast to text, fixing pipeline boot under PostgreSQL 15. ([#532](https://github.com/brlauuu/podlog/pull/532))
- Confidence reconciliation in `merge_candidates` no longer demotes high-confidence inferences. ([#534](https://github.com/brlauuu/podlog/pull/534))
- `PYANNOTE_MODEL` resolves the correct repo id, with an actionable error message when HF auth is missing. ([#539](https://github.com/brlauuu/podlog/pull/539))

## [0.1.1] — 2026-04-07

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

## [0.1.0] — 2026-04-04

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

## [0.0.0] — 2026-03-14 to 2026-04-03 (pre-versioning)

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
The early stack was inherited from a more complex design. PRs [#62](https://github.com/brlauuu/podlog/pull/62)–[#65](https://github.com/brlauuu/podlog/pull/65) reduced operational overhead substantially:

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

[Unreleased]: https://github.com/brlauuu/podlog/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/brlauuu/podlog/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/brlauuu/podlog/compare/v0.1.3...v0.2.0
[0.1.3]: https://github.com/brlauuu/podlog/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/brlauuu/podlog/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/brlauuu/podlog/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/brlauuu/podlog/releases/tag/v0.1.0
[0.0.0]: https://github.com/brlauuu/podlog/commits/main
