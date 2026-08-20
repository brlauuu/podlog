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

### Internal
- Runtime images are now published to the GitHub container registry on each release, so a future update can pull a known-good version instead of rebuilding several gigabytes of machine-learning dependencies locally. Nothing consumes them yet — wiring them into the compose setup and adding an update command come next. Each image builds in its own CI job, because the two largest are 13 GB and 17 GB and a standard runner has about 14 GB of disk; the heavy jobs reclaim space first. Also adds a check that fails the build if any workflow pastes a value into a shell command, after that mistake shipped once and was very nearly repeated. ([#937](https://github.com/brlauuu/podlog/issues/937))

## 0.7.0 — 2026-08-20

### Fixes
- Fixed the release workflow, which failed on its first real use. Release notes were being pasted into a shell command, so the backticks that appear throughout the changelog were run as commands instead of printed — the failed run went as far as executing a build command on the CI machine. Notes are now handed over as a file, which cannot be interpreted as code. ([#936](https://github.com/brlauuu/podlog/issues/936))

### Major changes

- Ask can now be scoped to a single speaker across every podcast and episode. Asking "what did X say about Y" used to retrieve whatever was most similar to Y regardless of who said it, because the stored embeddings carry no speaker information — the answer would then attribute those words to the person you asked about. A speaker dropdown on the Ask page, populated from the names you have confirmed, restricts retrieval to passages that person actually spoke. It works across episodes and feeds: diarization labels a given person differently in every episode, and the filter resolves through your renames rather than those raw labels. Verified on a real library — the same question returned passages from seven different people unscoped, and only the chosen speaker's, spanning four episodes, when scoped. ([#696](https://github.com/brlauuu/podlog/issues/696))
- The database, pipeline API and Ollama are no longer reachable from your local network. They were published on all interfaces, so any device that could route to the machine running Podlog could connect to PostgreSQL directly, or call the pipeline API — which has no authentication and whose settings endpoint holds your Fireworks and pyannote keys. All three are now bound to the machine itself, matching how the optional Jupyter service was already configured. The web interface is deliberately left reachable, so you can still open Podlog from a phone or another computer. Nothing else changes: the containers talk to each other over their private network, and the health check, `make` targets and documented `curl` commands all run on the same machine. ([#952](https://github.com/brlauuu/podlog/issues/952))

### Minor changes

- The installation guide now has a **Security model** section describing what is reachable from your network and what is not. Podlog assumes it runs on one machine you trust: the web interface is reachable from your network so you can browse from a phone, while the database, the pipeline API and Ollama are reachable only from the machine Podlog runs on. It also spells out the two changes that would break that assumption — re-publishing those ports, or moving the web container to a different host — and says to add authentication first if you need either. ([#960](https://github.com/brlauuu/podlog/issues/960))

### Internal

- The version number now lives in exactly one file. `apps/pipeline/pyproject.toml` and `apps/web/package.json` used to carry their own copies that had to be updated by hand, which is how the web one drifted five minor versions behind without anything noticing — nothing reads either at runtime. Both are now pinned to a `0.0.0` placeholder, leaving `/VERSION` and the git tag as the only two places a version appears. A new release workflow publishes the GitHub release automatically when a version tag is pushed, and refuses to do so if the tag disagrees with `/VERSION` or if the changelog still has unreleased entries that were never filed under the version being released. ([#936](https://github.com/brlauuu/podlog/issues/936))

## 0.6.0 — 2026-08-19

### Major changes

- Search is roughly 500x faster. A search that took about 19 seconds now takes about 33 milliseconds. Every query used to rebuild the entire speaker-turn structure from scratch: two window functions and a text concatenation across all 893,000 transcript segments, with the search index unusable because the searchable text was assembled on the fly. Turns are now stored in their own table with their own index, so a search reads what it needs instead of recomputing the corpus. This also fixes the failure it caused: because each search occupied a database connection for those 19 seconds, ten people searching at once exhausted the connection pool and every one of them got an error, even with everything else working perfectly. ([#942](https://github.com/brlauuu/podlog/issues/942), [#928](https://github.com/brlauuu/podlog/issues/928))
- Search results are now stable between identical queries. Speaker turns — consecutive runs by the same speaker, which search uses to group hits — were computed by ordering segments on start time alone. That is an incomplete sort key: 2,564 segments across 1,238 groups share a start time with another segment in the same episode, so the database was free to order them differently on each run. Running the same query twice over unchanged data produced 551 differently-grouped turns, which changes both which results are deduplicated together and the snippet text shown. Turn boundaries now break ties on the segment id, giving a total order and reproducible output. ([#942](https://github.com/brlauuu/podlog/issues/942))
- Podlog now records which model produced your embeddings, and refuses to write vectors from a different one. Two embedding models can share a dimension while producing completely unrelated vectors — `all-MiniLM-L6-v2` and `BAAI/bge-small-en-v1.5` are both 384-dimensional — so swapping one for the other passed every existing check, wrote successfully, logged nothing, and quietly made semantic search meaningless. The model is recorded on the first embed and a later mismatch is refused: the pipeline fails the job with an explanation, while search degrades to keyword-only rather than returning nonsense. The Settings page now shows which model built your corpus underneath the Embedding option, and a new verification endpoint re-embeds a sample of stored segments to check that claim against reality — a perfect score means the configured model reproduces your corpus, a low one means it does not. Provenance is tracked by model rather than by provider, so moving the same model between local and remote is correctly treated as no change at all. ([#945](https://github.com/brlauuu/podlog/issues/945))

### Fixes

- Uploading audio that contains no speech is now reported as its own outcome rather than as a system error. A file with nothing to transcribe would run the whole pipeline, fail at the final step with "Unexpected error", and still offer a Retry button that could only ever reach the same result. It is now recognised at transcription — where it is actually determined — and shown as "No speech detected", with no retry offered and no failure alert sent, because nothing malfunctioned. ([#955](https://github.com/brlauuu/podlog/issues/955))
- Settings now has a **Test key** button for the pyannote cloud API key. Previously an invalid or mistyped key was accepted silently and only revealed itself much later, as a failed diarization on an episode that had already been downloaded and transcribed — and the documentation worked around this by asking you to run a `curl` command yourself. You can test a key before saving it; if the field still shows a previously saved key in masked form, the button checks the saved one. ([#933](https://github.com/brlauuu/podlog/issues/933))
- The embedding model can no longer be set to an arbitrary value. The field was free text and was passed straight to the model loader, which treats it as a HuggingFace repository name and downloads whatever is there — and a known, currently unpatchable flaw in one of our machine-learning libraries runs code from a malicious repository during that download. It is now restricted to the two tested models, matching how the diarization model was already handled. ([#951](https://github.com/brlauuu/podlog/issues/951))
- Remote embedding is no longer offered, because it no longer works. Fireworks retired its serverless embeddings API: every model on `/inference/v1/embeddings` now answers `503 no healthy upstream`, including model names that do not exist — so the request never reaches model resolution, and the failure is not a transient outage. The remote-inference profile previously set `EMBEDDING_PROVIDER=fireworks` automatically, which meant `make up-remote` handed every user a pipeline whose embed stage failed on every episode; those episodes then never reached `done` and disappeared from search. Embeddings now always run locally, which costs little (the model is small and CPU-only, and needs no Ollama), and the Settings UI marks remote embedding unavailable with the reason. Anyone with the old setting stored in the database gets a warning at worker startup and an explanatory error on the failing job instead of a bare stack trace. `BAAI/bge-small-en-v1.5` is now selectable as a local model: installs that previously embedded through Fireworks can keep every vector they already have, because running that same model locally reproduces them exactly. ([#944](https://github.com/brlauuu/podlog/issues/944))
- Search no longer stalls for ~24 seconds per request when the pipeline container is down. Hybrid search asks the pipeline for a query embedding, and that call had no timeout — against an unresolvable host it sat in DNS retry rather than failing, long enough for requests to pile up and exhaust the database connection pool behind them. The call is now bounded (`EMBED_TIMEOUT_MS`, default 2s) and skipped entirely for a cooldown window after a failure (`EMBED_COOLDOWN_MS`, default 30s), so a missing pipeline costs a keyword-only result instead of a hung request. Keyword search reads Postgres directly and never needed the pipeline in the first place. ([#928](https://github.com/brlauuu/podlog/issues/928))

### Internal

- The Docker images are roughly half the size they were. Poetry caches every dependency wheel it downloads, and because that happened in the same build step as the install, 17 GB of cache was being baked permanently into each image. Clearing it in that same step brings the pipeline image from 30.4 GB to 13.4 GB and the worker from 33.9 GB to 16.9 GB, with nothing functional removed — the installed packages are byte-for-byte identical. This makes every rebuild cheaper and matters more if prebuilt images are ever published. ([#939](https://github.com/brlauuu/podlog/issues/939))
- Triaged the 14 security advisories in the optional machine-learning dependencies and recorded the result in `pyproject.toml`. None can be resolved by upgrading today: `whisperx` (at its latest release) pins both `torch~=2.8.0` and `huggingface-hub<1.0.0`, and the second of those transitively caps `transformers` below the version that fixes its advisories — so one package blocks every available fix. Three of the fourteen are not applicable at all, being matched against a version we do not run, and two have no fix in any release. The per-advisory reasoning is written down so future audits stop re-deriving it, along with the single condition that would unblock the rest. ([#951](https://github.com/brlauuu/podlog/issues/951))
- Upgraded FastAPI from 0.111.1 to 0.141.1, which moves Starlette from 0.37.2 to 1.6.0 and clears **9 security advisories** — the last known vulnerabilities in the non-ML Python dependencies, which now audit clean. Starlette handles every HTTP request the pipeline API serves, so these sat directly in the request path. The upgrade needed no application code changes: Podlog imports nothing from Starlette directly and uses only stable FastAPI APIs, so the middleware and background-task breaking changes that made this look expensive did not apply. `fastapi-cli` drops out of the dependency tree entirely. ([#906](https://github.com/brlauuu/podlog/issues/906))
- Speaker turns are now materialized into a `speaker_turns` table rather than derived on every search. The previous approach ran two window functions and a `string_agg` across the entire `segments` table before applying the text-search predicate, so the tsvector was rebuilt for the whole corpus on each request and the GIN index could never apply — 15.8 seconds per query on 893k segments, with search issuing two of them. The table stores its tsvector as a generated column with its own index; the same count query now takes 8 milliseconds. Turn-boundary logic lives in a single `rebuild_speaker_turns(uuid)` SQL function called by both the pipeline and the speaker-merge route, so the two runtimes cannot drift. Nothing reads the table yet — the query rewrite is a separate change. An hourly reconciler rebuilds any episode found with segments but no turns. ([#942](https://github.com/brlauuu/podlog/issues/942))
- The four `Promise.all` call sites in search now go through an `allHandled` helper. `Promise.all` settles on the first rejection and leaves its in-flight siblings without a handler; because the search queries share one connection pool they tend to fail together, so each saturation event logged a burst of `unhandledRejection` errors alongside the failed requests. Reproducing the pool timeout produced nine of them; it now produces none. ([#928](https://github.com/brlauuu/podlog/issues/928))
- Removed `buildNormalizedQuery` from `apps/web/src/lib/search/queryParser.ts`, whose only caller was its own test — the `parseSearchQuery` export from the same file is the one actually used. Its near-twin `verify_api_key` in `apps/pipeline/app/services/pyannote_cloud.py` looked equally dead and was deliberately **kept**: it is the finished half of an unfinished feature, since the settings UI has a pyannote API-key field with no way to check it and `docs/guide/13-pyannote-cloud.md` currently works around that by telling users to curl the endpoint themselves. A comment records why it stays, and [#933](https://github.com/brlauuu/podlog/issues/933) tracks wiring it to a "Test key" button. ([#913](https://github.com/brlauuu/podlog/issues/913))

## 0.5.7 — 2026-08-09

### Fixes

- Upgraded `python-multipart` from 0.0.22 to 0.0.32, clearing five advisories (PYSEC-2026-3036 through -3040) in the parser FastAPI uses to read uploaded files. This sits on an untrusted-input path — `POST /api/episodes/upload`, the manual episode upload — so it was the most exposed of the CVEs the new `pip-audit` gate surfaced. The constraint moved from `^0.0.22` to `>=0.0.31,<0.1`, because a caret on a `0.0.x` version resolves to an exact pin that `poetry update` can never move. ([#930](https://github.com/brlauuu/podlog/issues/930))
- Refreshed the web dependency lockfile, clearing 10 npm advisories (8 high). Two were direct dependencies: Next.js 16.2.6 → 16.3.0 (App Router middleware/proxy bypass, SSRF in Server Actions and rewrites, unauthenticated disclosure of internal Server Function endpoints, Image Optimization DoS) and postcss 8.5.15 → 8.5.23 (path traversal via attacker-controlled `sourceMappingURL`). Also picks up fixes in undici, ws, sharp, js-yaml, brace-expansion, nanoid, dompurify and @babel/core. No manifest change was needed — every fix was already within the declared version ranges. ([#905](https://github.com/brlauuu/podlog/issues/905))
- The Prompts section of `/settings` no longer hangs on "Loading prompts..." when the initial load fails. The error toast was set but could never render — the `prompts === null` early return sat above the toast markup — so a user whose `/api/prompts` request failed saw a permanent loading message with no error and no way to retry short of a page reload. Failed-to-load is now a distinct state from loading, showing an error and a Retry button; a non-OK response is also treated as an error rather than silently rendering as an empty prompt list. A failed refresh *after* a successful save keeps the existing list on screen instead of replacing it with the error. ([#893](https://github.com/brlauuu/podlog/issues/893))

### Internal

- Cleared the remaining non-ML Python CVEs by refreshing the pipeline lock: `pydantic-settings` 2.13→2.15, `urllib3` 2.6.3→2.7.0, `idna` 3.11→3.18, `requests` 2.32.5→2.34.2, `click` 8.3.1→8.4.2, `mako` 1.3.10→1.4.1, `pygments` 2.19.2→2.20.0, `python-dotenv` 1.2.1→1.2.2 and `setuptools` 79→84. No constraint changes were needed — all were transitive and in range. The CI dependency audit now also covers the optional ML group by exporting the lock instead of installing it, which is both faster and complete; that immediately surfaced 14 previously invisible advisories in `torch`, `transformers` and `lightning`. ([#915](https://github.com/brlauuu/podlog/issues/915))
- Lifted the three genuinely under-tested page components above the coverage threshold: `/ask` 65.85% → 95.73% (a new suite driving `handleSubmit`'s SSE reader loop — sources/token/error/done, the not-ok and network-failure branches, malformed-JSON tolerance, Clear, and the empty-question guard), `/feeds` 71.61% → 83.22% (the add-more and selective-preview flows), and `docs/DocsClient` 72.35% → 87.05% (markdown heading-id and link renderers, plus the docs search UI). 21 new tests. ([#912](https://github.com/brlauuu/podlog/issues/912))
- Refreshed the remaining in-range web dependencies (30 packages: Radix UI set, React Query, Playwright, Tailwind, `pg` 8.21→8.23, `@types/*`) and added an advisory `pip-audit` job to CI, so Python-side CVEs are visible for the first time — previously only the npm side had a vulnerability check. ([#915](https://github.com/brlauuu/podlog/issues/915))
- Bumped the Jupyter explore container's dependencies, untouched since it was introduced: jupyterlab 4.3.5→4.6.2, ipywidgets 8.1.5→8.1.8, pandas 2.2.3→3.0.5, numpy 2.2.2→2.4.6, plotly 5.24.1→6.9.0, sqlalchemy 2.0.36→2.0.51, psycopg2-binary 2.9.10→2.9.12. plotly mattered most: the web app moved to plotly.js 3.x / react-plotly.js 4.x, so figures authored in a notebook and figures rendered in the app were coming from different majors. numpy is deliberately held at 2.4.x — the image is `python:3.11-slim` and numpy 2.5+ ships no wheel for 3.11, so raising it further means bumping the base image, which is a separate decision; the constraint is recorded in the file. ([#908](https://github.com/brlauuu/podlog/issues/908))
- Corrected a batch of documentation inaccuracies found by a repo audit, across `CLAUDE.md`, the PRDs, and the guides: PRD-01 §10's endpoint list regenerated from the actual routers, PRD-02's queue retry path parameter corrected to `episode_id`, PRD-03's config filenames, migration count and Makefile block fixed, 19 undocumented env vars added, the backup service added to every service enumeration, `scripts/` described by what it actually contains, the ESLint gotcha's verification command fixed, and a missing `apps/pipeline/README.md` added so `poetry check` passes. Exhaustive file listings that had drifted are now marked as such so they stop being maintained by hand. ([#897](https://github.com/brlauuu/podlog/issues/897), [#911](https://github.com/brlauuu/podlog/issues/911))
- Hardened two web unit suites against silent misdirection. `prompts-section.test.tsx` now selects buttons from the prompt card whose label matches, instead of by position in the fixture (reordering the fixture previously broke 6 of 12 tests while looking like a component regression). `episode-chat-streaming.test.tsx` now records URLs its fetch mock doesn't recognise and fails in `afterEach` naming them — throwing from inside the mock does not work, because the call sits inside `EpisodeChat`'s own `try/catch`, which converts it into the generic "Connection failed" state. ([#895](https://github.com/brlauuu/podlog/issues/895))
- Lifted the remaining below-threshold chat/prompts/queue components above the coverage threshold: `EpisodeChat` 62.5% → ~99% (a new suite driving the SSE reader loop with a fake stream — sources/token/error/done events plus the markdown and plain-text conversation export), `QueueStatus` ~80% → ~89% (done-row rendering and retry error paths), and `PromptsSection` ~80% → ~95%. Also added a `TextEncoder`/`TextDecoder` polyfill to `jest.setup.ts`: jsdom omits them, and any component reading a streamed fetch body hit a `ReferenceError` that its own `try/catch` swallowed into a misleading "connection failed" state. ([#885](https://github.com/brlauuu/podlog/issues/885))

## 0.5.6 — 2026-08-04

### Minor changes

- CPU transcription now uses all available cores instead of 4. WhisperX defaults its CTranslate2 ASR pass to `threads=4`, which pinned Whisper to 4 cores regardless of machine size (a 99-minute episode was taking 8+ hours on an 8-core host). A new `WHISPER_CPU_THREADS` setting is passed through to `load_model` (`0` = auto-detect available cores; set to the physical-core count on hyperthreaded CPUs), roughly halving per-episode transcription time on multi-core hosts. ([#863](https://github.com/brlauuu/podlog/issues/863))

### Internal

- Lifted the episode-view components above the coverage threshold (from ~76–78%): `AudioPlayer` (~92%: no-src halt, seek-bar click, Space toggle), `SpeakerFilter` (~94%: non-array response, outside-click close, selected display, All-speakers, error+retry), `TranscriptView` (~95%: activeSpeaker filter, scroll-to-time event, timestamp→playback in both layouts), and `SpeakerPanel` (~90%: rename failure/no-op paths, edit-mode save, show/hide-segments filter, Show-all, merge-failure toasts). ([#884](https://github.com/brlauuu/podlog/issues/884))
- Lifted the Notifications settings components above the coverage threshold (from ~72%): `NotificationSectionCards` to ~98% (a new direct-render suite for the Telegram/Email/General cards — field edits, test buttons, the SMTP sub-panel, and the email-tag backspace/blur paths) and `NotificationSettings` to ~92% (the schema-shape-mismatch guard, save error/network-error toasts, the fireworks-key-warning path, and the Telegram test-message flow). 13 new tests. ([#883](https://github.com/brlauuu/podlog/issues/883))
- Lifted the Remote-Inference settings components above the coverage threshold (from 69–78%): `RemoteInferenceFireworksParts` and `RemoteInferencePyannoteParts` (API-key field edits + show/hide toggle) and `RemoteInferenceSection` to 100%, and `RemoteInferencePipelineCards` to ~97% (the `handleToggle` require-API-key path, `handleModelChange` local/remote branches, and `StepHelpContent` estimates). 13 new tests across 4 files, mocking the Radix `Select`/`Popover` primitives so the handler logic is what's exercised. ([#882](https://github.com/brlauuu/podlog/issues/882))
- Lifted the web search library files to 100% coverage (from 66–72%): `lib/search/filters.ts` (all SQL-clause builders — speaker/segment/metadata filters, `buildLikePattern`, `appendFilterSql`), `lib/search/embedding.ts` (`getQueryEmbedding` success/not-ok/throws paths), and the `lib/search.ts` re-export barrel. 13 new tests across 3 new files. ([#881](https://github.com/brlauuu/podlog/issues/881))
- Lifted the web feeds API route handlers to 100% statement coverage (from 62–77%): `api/feeds`, `api/feeds/[id]` (the previously-untested `PATCH` pause/resume proxy), `api/feeds/[id]/episodes/guids` (new test file), and `api/feeds/preview` (`GET`, missing-url 400, and malformed-body paths). 14 new tests exercise the non-JSON-upstream and fetch-throws-500 error branches. ([#880](https://github.com/brlauuu/podlog/issues/880))
- Lifted `apps/pipeline/app/services/pyannote.py` test coverage to 100% (from 93%; the 2026-08-02 audit's 66% figure was already stale after the #864 stub fix). 4 targeted tests cover the CUDA-move branch, the `_is_hf_auth_error` `ImportError` fallback, and the `diarize()` temp-WAV cleanup (including the swallowed `OSError`). ([#879](https://github.com/brlauuu/podlog/issues/879))
- Synced `apps/pipeline/pyproject.toml` version (`0.1.0` → `0.5.4`) to match the repo-root `VERSION` file, and added a comment noting the runtime version is read from `VERSION` (this field is packaging metadata only). ([#871](https://github.com/brlauuu/podlog/issues/871))
- Removed dead module `apps/web/src/lib/metaAnalysisColors.ts` (and its test). Its `FEED_COLOR_PALETTE` / `colorForFeed` exports were never imported by any component, page, or route — only by their own test. Also dropped it from the CLAUDE.md lib listing. ([#870](https://github.com/brlauuu/podlog/issues/870))
- Upgraded `react-plotly.js` from 2.6.0 to 4.1.0 (two majors). The Meta-Analysis charts use only the stable `react-plotly.js/factory` API fed `plotly.js-cartesian-dist-min`; 4.1.0's peer deps (`plotly.js >=3.0.0`, `react ^18||^19`) are already satisfied. Verified in a browser that the charts render with no console errors in both light and dark themes. ([#867](https://github.com/brlauuu/podlog/issues/867))
- Clarified the "Full end-to-end pipeline smoke test in CI" not-yet-done item in `CLAUDE.md`: the full-flow e2e test exists (`apps/pipeline/tests/e2e/test_full_flow.py`) but no CI job runs it (`ci-slow.yml` runs only pipeline `tests/integration/` + the web Playwright suite), so the item stays accurate — the remaining work is wiring `tests/e2e/` into CI. ([#866](https://github.com/brlauuu/podlog/issues/866))
- Corrected the service count in `CLAUDE.md`: the stack defines 7 compose services and `make up` starts 6 (db, pipeline, worker, ollama, web, backup); `explore` is opt-in via the `explore` profile. The doc previously said "5 services". ([#865](https://github.com/brlauuu/podlog/issues/865))
- Made `test_pyannote_service.py`'s ML import-stubs order-independent. The stubs were installed once at collection time but guarded only the parent `pyannote` package, so when the real `pyannote` package was importable (or an earlier-collected test placed bare `pyannote` in `sys.modules`), `pyannote.audio` was left unstubbed and 7 tests failed with `KeyError` depending on collection order. Each submodule is now guarded independently and re-ensured before every test via an autouse fixture. ([#864](https://github.com/brlauuu/podlog/issues/864))

## 0.5.5 — 2026-06-21

### Fixes

- The footer no longer falsely shows "→ x.y.z (rebuild available)" after a plain `docker compose build web`. The web image build now reads the repo-root `VERSION` file directly (build context moved to the repo root, guarded by a new root `.dockerignore` so the context stays small), instead of defaulting to the `0.0.0` sentinel when the caller forgot to pass `--build-arg APP_VERSION`. `make build` is unaffected.
- The pipeline API no longer reports version `0.0.0` after a plain `docker compose build`. The live `VERSION` file is now bind-mounted into the pipeline container (`./VERSION:/app/VERSION:ro`), so `app.main._read_version()` always reads the current version at runtime instead of relying on a copy that only `make build` staged into the build context.
- `make ollama-pull` referenced a non-existent Ollama model `gemma4:e4b`; corrected to `gemma3n:e4b` (the Gemma 3n E4B variant) in the Makefile, the Ask page model dropdown (`apps/web/src/lib/rag-models.ts`), and the two doc pages that listed the pullable model set. ([#790](https://github.com/brlauuu/podlog/issues/790))

### Internal

- Fixed the `CI Slow (Integration and E2E)` suite, red on every scheduled run since the PRD-06 meta-analysis rewrite. Three stale tests left behind by refactors: (1) `test_backup_script.py` computed the repo root with a hard-coded `parents[4]`, raising `IndexError` in the pipeline test container (repo at `/app`) and aborting collection of the whole integration suite — now it locates `apps/backup/backup.sh` by walking parents and skips when absent; (2) `test_oom_marks_episode_failed` and (3) `test_fireworks_transient_failure_then_recovery_is_idempotent` asserted error-classification behavior that moved from `transcribe_episode` into the worker (#641/#653, covered by `test_worker.py`) — the OOM one is deleted as redundant and the transient one is rewritten to cover transcribe's unique re-run idempotency. Also updated `meta-analysis.spec.ts` to assert the new Plotly charts' empty-state strings (the old nine-Recharts fallbacks no longer exist).
- Lifted pipeline test coverage on `meta_analysis_aggregations.py` from 60% to 91% statements (flagged by the 2026-06-01 audit). 62 new unit tests mirror the existing integration suite against a queue-based fake `Session`: pure helpers (`_episode_speaker_diff`, `_confirmed_role_map`, `_merge_inferred_fragments`, `_identify_feed_host`, `_host_speaker_label_for_episode`) tested directly; DB-driven helpers (`_per_episode`, `_per_speaker`, `_per_episode_speaker`) driven with canned row tuples. `_coverage_and_host_share` deferred — multi-table fixture is integration-test territory. Pipeline overall: 87.68% → 89.46%. ([#795](https://github.com/brlauuu/podlog/issues/795))
- Lifted web test coverage on `MetaAnalysisClient.tsx` from 58.82% to 94.11% statements (flagged by the 2026-06-01 audit). 8 new tests extend the existing 3 — covers the full-snapshot render path, the Refresh button mutation flow, `is_stale` and `computed_at` header branches, the feed-filter passthrough from `FiltersBar`, the source-tab switch, and both happy/fallback paths of the missing-speakers modal fetch. Uses probe mocks for the chart and panel children. ([#796](https://github.com/brlauuu/podlog/issues/796))
- New user guide page [`docs/guide/19-inference-providers.md`](docs/guide/19-inference-providers.md) comparing local vs remote options for transcription (WhisperX / Fireworks) and diarization (pyannote / precision-2) side by side, with a decision matrix and a "Considered and rejected" section that records Soniox (#757) so the question doesn't get re-litigated. Cross-linked from `README.md` and PRD-01 §5.4. ([#787](https://github.com/brlauuu/podlog/issues/787))
- Lifted pipeline test coverage on `backup_settings.py` from 26% to 100% (lowest-covered file flagged by the 2026-05-29 audit). 16 new unit tests mirror the existing integration suite against a fake `Session` so the CI coverage gate (`pytest tests/unit --cov=app`) measures the real surface. ([#762](https://github.com/brlauuu/podlog/issues/762))
- Lifted web test coverage on five files flagged by the 2026-05-29 audit as ~0% statements: `settings/page.tsx`, `queue/page.tsx`, `search/print/PrintButton.tsx`, `feeds/_lib/types.ts` (`formatDuration`), `EpisodeChatExports.ts`. 26 new tests across 5 new files; all five files now at 100% statements. ([#763](https://github.com/brlauuu/podlog/issues/763))
- Lifted web test coverage on five Meta-Analysis chart files flagged by the 2026-05-29 audit: `HostGuestDiffChart` (13 → 100%), `SpeakerMinutesChart` (14 → 100%), `SpeakerWordsChart` (14 → 100%), `usePlotlyTheme` (8 → 92%), `PlotlyChart` (15 → 70%). 35 new tests across 5 new files using a PlotlyChart probe-mock pattern. ([#764](https://github.com/brlauuu/podlog/issues/764))

## 0.5.4 — 2026-05-29

### Minor changes
- **Global navigation chords (#704):** Gmail / GitHub-style two-key chords for jumping between top-level pages. Press <kbd>G</kbd>, then within ~1 s the destination key: <kbd>H</kbd> Home, <kbd>Q</kbd> Queue, <kbd>F</kbd> Feeds, <kbd>P</kbd> Podcasts, <kbd>A</kbd> Ask, <kbd>M</kbd> Meta-analysis, <kbd>S</kbd> Settings, <kbd>D</kbd> Docs. The chord is cancelled if you hold <kbd>Ctrl</kbd> / <kbd>Cmd</kbd> / <kbd>Alt</kbd>, so browser shortcuts still work. Listed in the <kbd>?</kbd> help overlay and the keyboard-shortcuts doc.

### Internal
- Lifted web test coverage on eight files that were flagged by the 2026-05-29 audit as <60% statements: `feeds/_lib/api.ts` (21 → 95%), `QueryProvider` (40 → 100%), `ReprocessButton` (33 → 94%), `EpisodeChatMessage` (50 → 88%), `PodcastFilter` (52 → 100%), `EpisodeSelectionStep` (17 → 100%), `feeds/page.tsx` (37 → 72%), `search/page.tsx` (51 → 80%). 69 new tests across 7 new files + 2 extended files. ([#765](https://github.com/brlauuu/podlog/issues/765))
- Declared `@types/plotly.js` as a direct devDependency so the chart components' `import type { Data, Layout } from "plotly.js"` no longer relies on transitive resolution through `@types/react-plotly.js`. ([#759](https://github.com/brlauuu/podlog/issues/759))
- Refreshed `CLAUDE.md` repo-structure section to match disk: added PRD-05 and PRD-06 to the documentation table; added `meta_analysis_aggregations` to the services enumeration, `semver.ts` and `useChordShortcut.ts` to the lib enumeration, and `version` to the web API enumeration. ([#766](https://github.com/brlauuu/podlog/issues/766), [#767](https://github.com/brlauuu/podlog/issues/767), [#768](https://github.com/brlauuu/podlog/issues/768), [#769](https://github.com/brlauuu/podlog/issues/769))
- Refreshed `docs/development.md` repo-structure paragraph to match disk: API listing now includes `version` and `search/speakers`; pipeline-proxy `embed`/`explore` subroutes; lib utilities list now includes `search/*`, `searchHybrid`, `metaAnalysisColors`, `metaAnalysisStale`, `page-state`, `queueStatus`, `normalizeName`, `filename`, `semver`, `useChordShortcut`. ([#760](https://github.com/brlauuu/podlog/issues/760), [#761](https://github.com/brlauuu/podlog/issues/761))
- PRD-06 status marked `Shipped` (PR #745). ([#775](https://github.com/brlauuu/podlog/issues/775))

## 0.5.3 — 2026-05-29

### Minor changes
- **Meta-Analysis loads ~70% faster (#746):** swapped `plotly.js-dist-min` (4.5 MB minified) for `plotly.js-cartesian-dist-min` (1.3 MB) wired through `react-plotly.js/factory`. All PRD-06 charts only use scatter traces, which the cartesian bundle fully covers. Lazy chunk shrinks correspondingly, masking the slow first paint that the spinner previously had to hide.

### Internal
- Meta-Analysis chart titles and legend entries truncate unknown feed titles at 20 characters (with an ellipsis) instead of letting the full RSS title overflow. Hand-curated names in `feedShort` still pass through verbatim. ([#747](https://github.com/brlauuu/podlog/issues/747))
- `notebooks/.gitignore` now excludes rendered HTML artifacts (`examples/*.html`, `examples/_*.html`) so `jupyter nbconvert --to html` output stays out of `git status`. ([#748](https://github.com/brlauuu/podlog/issues/748))

## 0.5.2 — 2026-05-29

### Minor changes
- **Inferred-speaker noise filter on Meta-Analysis (#749):** the Inferred — HIGH view now drops obvious platform tokens (`Twitter`, `LinkedIn`, `Apple`, `Spotify`, `YouTube`, …) and merges first-name fragments into the longest sibling within each feed (e.g. `Marko` rolls into `Marko Papic`). Confirmed-by-user speakers are not touched. Snapshot must be recomputed (↻ Refresh) for the filter to take effect.

### Internal
- Jest now ignores `apps/web/.next/standalone/` so a local `npm run build` doesn't trip jest-haste-map with `duplicate manual mock found: react-markdown`. The standalone output contains copies of `__mocks__/` and `node_modules/react/` that collided with the canonical ones; six suites previously failed at collection on a freshly-built local tree. CI was unaffected because it builds fresh, but the fix is harmless there. ([#750](https://github.com/brlauuu/podlog/issues/750))

## 0.5.1 — 2026-05-29

### Minor changes
- **Per-feed pause toggle (#743):** Each feed on `/feeds` now has a pause/resume icon button. Paused feeds are skipped by the periodic poller and manual "Poll now" returns 422 until resumed. Already-processed episodes are untouched; on resume the next poll picks up anything published in the gap. Adds a `feeds.paused` boolean (migration 020) and a `PATCH /api/feeds/{id}` endpoint.

## 0.5.0 — 2026-05-18

### Major changes
- **Meta-Analysis page rewrite (PRD-06):** Replaced the nine Recharts cards with six Plotly figures — per-speaker minutes per episode, per-speaker word count per episode, and host-vs-guest talking-time diff, each shown for both Confirmed and Inferred-HIGH speaker sources. Each chart has a per-feed dropdown, click-to-open-episode (Next.js router push to `/episodes/{id}`), unified hover with spike lines, and dark/light theme switching tied to the app's `<html class="dark">`. Existing chrome (refresh, FiltersBar, CoverageStrip, MissingSpeakersModal, ExploreStatusPanel, InfoBlock) preserved. Backed by two new snapshot arrays (`per_episode_speaker`, `episode_speaker_diff`) computed by `apps/pipeline/app/services/meta_analysis_aggregations.py`; no DB migration required (single-row JSONB snapshot table).
- **Speaker analytics in the explore notebook (PRD-06 bonus):** New `notebooks/lib/podlog_plots.py` module (port of the prototype) + three new figure cells in `01_explore_db.ipynb` driven by an ipywidgets source toggle (Confirmed / Inferred-HIGH).

### Minor changes
- Footer shows the version of the running build and warns when a newer one is on disk. The footer reads `process.env.NEXT_PUBLIC_APP_VERSION` (baked into the image at build time) for "what's running," and fetches `/api/version` (which reads the `VERSION` file bind-mounted into the container at `/version`) for "what's on disk." When the on-disk semver is strictly greater than the built-in one, the footer renders `v0.X.Y → 0.X.Z (rebuild available)` in amber as a nudge to rebuild + restart. Silent in matched / downgrade / file-missing / fetch-failed cases.

### Fixes
- Speaker inference: a short pyannote run inside an otherwise-real label is now split off as Other when its nearest same-label neighbour is more than 60 s away. Catches the case where pyannote conflates a short cold-open / pre-roll voice with a real speaker's voice into one label — previously the cold-open got silently attached to the real speaker. Mid-conversation interjections (host's "yeah" between guest answers) stay with the parent speaker because their gap-to-nearest-same-label is small. Follow-up to #703. ([#703](https://github.com/brlauuu/podlog/issues/703))

## 0.4.6 — 2026-05-14

### Major changes
- **Speaker inference tuning.** Five-PR series fixing the biggest miss-classes the issue thread surfaced: phantom rows for cached recurring guests, cold-open / skit voices labeled as the host, and the per-feed cache flooding every episode with names that weren't there. Net behavior change: pyannote labels that have no run of ≥ 15 s or ≥ 20 segments fragment into per-run SPEAKER_NN slots marked `role='other'` (ready to merge from the UI). `feed_speaker_cache` rows for SPEAKER_NN slots only seed candidates when this episode's title / description / `<podcast:person>` corroborates the name. A new fifth NER source reads the first ≤ 300 s of transcript text to catch on-air self-introductions. The Speaker Management guide has a new "Under the hood: how speaker inference works" section with GitHub source links. ([#703](https://github.com/brlauuu/podlog/issues/703))

### Minor changes
- New **Keyboard Shortcuts** page in the user guide (`docs/guide/18-keyboard-shortcuts.md`) covering every binding the `?` help overlay shows. The in-app catalog (`apps/web/src/lib/keyboardShortcuts.ts`) now cross-references the doc so the two stay in sync. ([#730](https://github.com/brlauuu/podlog/issues/730))

### Fixes
- Swapped episode-navigation shortcuts: <kbd>J</kbd> is now **previous episode**, <kbd>K</kbd> is **next episode**. The `?` help overlay and the keyboard-shortcuts doc reflect the new mapping. ([#739](https://github.com/brlauuu/podlog/issues/739))
- Docs page section anchors no longer hide their heading behind the sticky navbar after a TOC click or `scrollIntoView` jump. Headings now have a `scroll-margin-top` so they land below the navbar with breathing room. ([#729](https://github.com/brlauuu/podlog/issues/729))

### Internal
- Codebase audit cleanup batch closing out the 2026-05-06 audit (23 sub-issues, single umbrella #680):
  - Refactors of files that had grown past the 500-LOC house guideline — `meta_analysis.py` (#662), `RemoteInferenceSectionParts.tsx` (#663), `feeds/page.tsx` (#664), `EpisodeChat.tsx` (#665). All splits are pure code motion with back-compat re-export surfaces.
  - Web-side test coverage lifted: new tests for the `/api/backups` (#666), `/api/prompts` (#667), and `/api/pipeline/explore/status` (#668) proxy routes; for the `/feeds` (#669), `/podcasts` (#670), `/search/print` (#671), and `/meta-analysis` + `/docs` (#672) pages; for nine previously-under-tested components (#673); and for `lib/formatFileSize.ts` (#674).
  - Pipeline-side test coverage lifted for the prompts service / API and the spaCy load/unload helpers in `services/inference.py` to ≥98% statements (#675).
  - Dependency hygiene: declared `huggingface-hub` as a direct pipeline dep (#657), patched `@types/node` within the Node 20 line (#677), and refreshed the lock file via `npm update` (#678).
  - Docs sync: CLAUDE.md repo-structure tree (#658) and `docs/development.md` Makefile table (#659) refreshed to match disk; PRD-02 §5.6 reconciled with RISKS-AND-GAPS RISK-03 (#660); README + `docs/hardware.md` + PRD-01 minor cleanups (#661).
  - New CI check `scripts/check_docs_sync.py` fails any PR that leaves CLAUDE.md or `docs/development.md` pointing at paths that don't exist on disk (#679).
  - CLAUDE.md gains an Operational Gotcha noting the recurring ESLint 9 → 10 upstream block (`eslint-plugin-react@7.37.5` uses the removed `context.getFilename` API) so future audit re-discoveries are recognized as duplicates of #494.

## 0.4.5 — 2026-05-13

### Major changes
- **Keyboard shortcuts across the web app.** On an episode page, `J` / `K` jump to the next / previous episode in the same feed (swapped to previous/next in 0.4.6 below). Globally, `/` focuses the nearest search input (or navigates to `/search` if none is on the page), `?` opens a help overlay listing every shortcut, and `Esc` closes dialogs. When audio is playing, `Space` toggles play/pause and `←` / `→` seek ±10 seconds. All shortcuts are skipped while typing in an input, textarea, or contenteditable field. ([#702](https://github.com/brlauuu/podlog/issues/702))

### Internal
- Doc/process cleanup batch from the 2026-05-06 codebase audit umbrella (#680):
  - `huggingface-hub` declared as a direct pipeline dep (#657).
  - CLAUDE.md repo-structure tree (#658), `docs/development.md` Makefile table (#659), RISKS-AND-GAPS RISK-03 reconciled with PRD-02 §5.6 (#660), and README / `docs/hardware.md` / PRD-01 cleanups (#661).

## 0.4.4 — 2026-05-10

### Major changes
- **Assign speaker roles on the episode page.** Each speaker card on `/episodes/[id]` now has Host / Guest / Other buttons. The choice is saved per-episode (new `role` column on `speaker_names`); clicking the active role clears it. Cards are reordered by role: hosts first, then guests, then others, then unassigned. The previous automatic "Host" / "Guest" pill (based purely on the SPEAKER_NN slot number) is replaced by one driven by the actual role. ([#698](https://github.com/brlauuu/podlog/issues/698))
- **Delete individual backups from Settings → Backups.** Each DB dump (daily/weekly/monthly) and each audio snapshot now has a Delete button. Clicking opens a confirmation modal showing what's about to be removed; on confirm, the file/dir is unlinked and the dashboard refreshes. Hardlinks across tiers are unaffected (only the named directory entry is removed). Today's audio snapshot is refused when the day's backup tick hasn't finished yet (mid-rsync guard). Pipeline `/backups` mount is now read-write to support these endpoints; the only writes the pipeline performs there are the two DELETE handlers, both gated by tier/filename/date regex anchors and a path-traversal guard. ([#687](https://github.com/brlauuu/podlog/issues/687))

### Minor changes
- Episode Ask popup is now multi-turn aware. Each new question carries the prior Q&A pairs to the model so follow-ups like "what about pricing?" understand "what" refers to the previous answer. Capped to the last 4 pairs (8 messages) on both client and server to stay inside small-context local models. Retrieval still uses just the latest question — query rephrasing for follow-ups is tracked separately. ([#699](https://github.com/brlauuu/podlog/issues/699))
- Meta-Analysis: explore-notebook status panel moved to the top of the page (above the filters bar) and now reveals the CLI commands needed to start it on expand. The not-running state shows a "Show how to start it" toggle that exposes a copy-friendly `make explore` / `make explore-logs` block, plus a Docs link for the full walkthrough. Running state behavior unchanged. ([#690](https://github.com/brlauuu/podlog/issues/690))

### Fixes
- Ask answers no longer mention `SPEAKER_00` for chunks from sibling episodes after a user has confirmed a speaker name elsewhere in the same feed. The retrieval query now consults the feed-level speaker cache as a fallback to the per-episode `speaker_names` table — single rename now reaches every episode of the feed at display time. Embeddings are unchanged (chunk text was already speaker-agnostic, so no re-embed needed). ([#695](https://github.com/brlauuu/podlog/issues/695))

## 0.4.3 — 2026-05-09

### Major changes
- **Backup retention is now editable from Settings → Backups.** A new Retention section lets you change daily / weekly / monthly counts at runtime. Saved values are stored in the DB; the backup container reads them at the start of every tick (within 1 hour) — no restart needed. Same `daily=0` + `weekly>0|monthly>0` validation as the env-var path. Empty values fall back to the build-time env defaults. ([#683](https://github.com/brlauuu/podlog/issues/683))

### Minor changes
- Local pyannote diarization model is now a runtime choice in Settings → Remote Inference. Pick between `pyannote/speaker-diarization-community-1` (default) and `pyannote/speaker-diarization-3.1` (legacy). Switching unloads the previous model and loads the new one on the next diarization run; first run after the switch is slow (model download), subsequent runs use the cached weights. Both models are HF-gated — accept the gate at huggingface.co before selecting. ([#681](https://github.com/brlauuu/podlog/issues/681))
- Backup retention now accepts `0` (disable that tier — no file written, no promotion) and `1` (rolling latest — overwrite on each run) for `BACKUP_RETENTION_DAILY`, `_WEEKLY`, and `_MONTHLY`. `DAILY=0` with `WEEKLY>0` or `MONTHLY>0` is rejected at startup since weekly and monthly hardlink from the daily file. ([#682](https://github.com/brlauuu/podlog/issues/682))

### Fixes
- Settings → Inference: the Save button now persists changes to diarization fields (`diarization_provider`, `pyannote_model`, `pyannote_api_key`, etc.). They previously routed to the wrong dirty bucket and the click was a silent no-op until you switched to the Notifications tab. Pre-existing bug, surfaced when #685 added the local-model dropdown. ([#688](https://github.com/brlauuu/podlog/issues/688))
- Settings tab "Remote Inference" renamed to "Inference" — the tab covers both local and remote inference settings (provider toggles, local pyannote / RAG model picks, Fireworks credentials), so the old label was misleading. ([#689](https://github.com/brlauuu/podlog/issues/689))

## 0.4.2 — 2026-05-06

### Major changes
- **Editable LLM system prompts.** Settings → Prompts (new tab) lets you edit the system prompt sent to the LLM for the Ask page and the per-episode Ask popup independently. Build-time defaults come from `PROMPT_ASK_PAGE_SYSTEM` / `PROMPT_ASK_EPISODE_SYSTEM` env vars; UI saves are stored in a new `prompt_settings` table; **Reset to default** clears the override and falls back to the env value. Both prompts ship with the same default text but can diverge after editing. ([#643](https://github.com/brlauuu/podlog/issues/643))

## 0.4.1 — 2026-05-05

### Fixes
- Transient errors in `embed`, `chunk`, `infer`, `archive` no longer strand episodes mid-pipeline. The worker loop now classifies any exception that escapes a task — network errors, DNS failures, connection resets, timeouts, and equivalent-by-message OS errors — as transient and re-enqueues the same task with exponential backoff, up to `retry_max=3` attempts. Non-transient errors mark the episode `failed` with `SYSTEM_ERROR` instead of leaving it stuck in a status like `embedding`. A new `recover_stranded_episodes` periodic task (every 30 min) acts as a safety net: it finds any episode in a non-terminal status with no active job and re-enqueues it at the right stage. ([#641](https://github.com/brlauuu/podlog/issues/641))
- `FIREWORKS_UPLOAD_REJECTED` is now retryable. The TLS-abort signature (`BAD_RECORD_MAC`) was originally classified as non-retryable on the assumption it indicated a hard size/duration cap (#600). Bulk-reprocessing data showed it's actually transient (~14% per-attempt failure rate at any episode size, ~99% recovery on retry), so the standard `retry_max` budget now applies. Episodes only land in `failed` after retries are exhausted; the failure notification copy is updated to reflect this. ([#641](https://github.com/brlauuu/podlog/issues/641))
- Manual upload retry no longer fails with `Invalid IDNA hostname` when the original filename had non-ASCII characters. `enqueue_episode_ingest` now detects manually-uploaded episodes (rows with a `local://` URL and an existing on-disk file) and starts them at `transcribe`, mirroring the original upload path. If the on-disk file is gone, `download` short-circuits with a dedicated `MANUAL_UPLOAD_FILE_MISSING` terminal failure that says "re-upload the file" instead of an opaque protocol error. ([#650](https://github.com/brlauuu/podlog/issues/650))
- Fireworks transcription HTTP errors now include the API response body. Previously a 4xx from Fireworks surfaced as `Fireworks API HTTP 400` with no actionable detail; the failure notification and queue-page error message now read `Fireworks API HTTP 400: <reason>` (truncated to 500 chars), parsing the OpenAI-compatible `{"error": {"message": ...}}` shape with fallback to plain text. ([#650](https://github.com/brlauuu/podlog/issues/650))

### Internal
- Consolidated retry logic into the worker loop. `download.py` and `transcribe.py` no longer carry their own `_handle_transient_failure` helpers, retry-budget bookkeeping, or wrapping `try/except` blocks for network / HTTP / Fireworks errors — those now propagate to the worker's `_classify_for_retry`. Typed exceptions carrying `retryable: bool` + `error_class: str` (e.g. `FireworksTranscriptionError`) win and keep their semantic class; `MemoryError` is terminal `OOM`; `httpx.HTTPStatusError` 5xx/429 retries as `TRANSIENT_NETWORK`, 4xx is now **terminal** `HTTP_ACCESS` (small behavior change — a 404/403/410 isn't going to resolve on retry, so failing fast saves bandwidth and gives the user a clear signal). The terminal cases that genuinely deserve specific error classes (`DISK_FULL`, `MANUAL_UPLOAD_FILE_MISSING`) stay as per-task short-circuits. ~140 lines net deletion across the pipeline. ([#653](https://github.com/brlauuu/podlog/issues/653))

## 0.4.0 — 2026-05-01

### Major changes
- **Daily backups of the database and audio archive.** New `backup` Docker service runs as part of the standard stack, writes `pg_dump --format=custom` files and incremental `rsync --link-dest` audio snapshots to `./backups/` on the host. Retention is 7 daily / 4 weekly / 12 monthly (configurable, set any to 0 to disable). Restore via `make restore-db DATE=...` and `make restore-audio DATE=...` with confirmation prompts. Idempotent across container restarts. See `docs/guide/16-backups.md`. ([#630](https://github.com/brlauuu/podlog/issues/630))

### Minor changes
- Settings page gains a Backups tab listing the available DB dumps (daily/weekly/monthly) and audio snapshots with their dates and sizes, plus the last-run flag and current retention. Read-only — restore is still via `make restore-db DATE=...` / `make restore-audio DATE=...`. Backed by a new pipeline `/api/backups` endpoint that reads the `./backups/` directory mounted read-only into the pipeline container. ([#646](https://github.com/brlauuu/podlog/issues/646))
- Audio file size tag on the episode page and podcast episode cards. Shows the size of the file actually processed by transcription (the 16 kHz mono WAV for local Whisper, the raw download for Fireworks). Existing episodes show no tag until a backfill is run. ([#634](https://github.com/brlauuu/podlog/issues/634))
- Ask page and episode chat answers now render as Markdown. Bold, lists, headers, and links in model responses (e.g. from Gemma 4) are displayed properly. The RAG system prompt now instructs models to use Markdown formatting. ([#638](https://github.com/brlauuu/podlog/issues/638))

### Fixes
- Right-rail TOC links on the About page now scroll to the right release. The version headings (`## [0.3.0] — ...`) used markdown reference-link syntax, which made react-markdown render `[0.3.0]` as an anchor pointing to a non-resolvable GitHub compare URL and caused the rendered heading text to drift from the slug used by the TOC, leaving each `<h2>` with no `id`. Reference-link syntax is dropped from version headings (`## 0.3.0 — ...`), the broken compare-URL link defs at the bottom of the file are removed, and the About page version filter is updated to match the new format. ([#644](https://github.com/brlauuu/podlog/issues/644))
- Curated Fireworks chat models in Settings → Remote Inference → RAG / Ask refreshed. The previous picks (`qwen2p5-7b-instruct`, `llama-v3p1-70b-instruct`, `qwen2p5-72b-instruct`) all returned 404 from Fireworks's serverless endpoint, and the obvious next-generation replacements (`qwen3-8b`, `llama-v3p3-70b-instruct`, `deepseek-v3p1`) were announced as obsolete in a May 2026 Fireworks deprecation notice. Curated trio now follows Fireworks's stated migration targets: `gpt-oss-20b` (Fast), `gpt-oss-120b` (Balanced), `glm-5p1` (Quality). Default `FIREWORKS_CHAT_MODEL` follows. Existing installs with the env var or stored setting set explicitly keep their value. ([#636](https://github.com/brlauuu/podlog/issues/636))
- Local RAG model selection in Settings → Remote Inference now works. Picking a model from the RAG / Ask step's dropdown persists the choice as `rag_local_model`; the Ask page and episode chat use this as the default when no per-session selection has been made. ([#637](https://github.com/brlauuu/podlog/issues/637))
- Cost-tag tooltips on the episode page (Fireworks STT, pyannote cloud) had a transparent background — caused by a `bg-popover` Tailwind class whose `--popover` CSS variable is not defined in `globals.css`. Switched to the defined `bg-card` / `text-card-foreground`. Same fix applied to the duplicate tooltips on podcast-page episode cards.

## 0.3.3 — 2026-04-30

### Minor changes
- `/about` page layout now matches the docs page: centered content with a sticky right-rail TOC ("On this page") that lists two top-level entries (**About**, **Changelog**) and version numbers nested under Changelog. Clicking a version number jumps to that section heading. Replaces the previous flat "Releases" sidebar. ([#620](https://github.com/brlauuu/podlog/issues/620))
- Settings → Remote Inference now links out to the Fireworks dashboard from both the API key field ("Generate at fireworks.ai/account/api-keys") and the "What are remote inference providers?" explainer, mirroring the existing pyannote.ai dashboard links. ([#618](https://github.com/brlauuu/podlog/issues/618))
- Optional Jupyter-based DB exploration service (advanced). Opt-in via `make explore` (Compose profile `explore`); ships with JupyterLab, pandas, numpy, plotly, sqlalchemy preinstalled and a starter notebook (`notebooks/examples/01_explore_db.ipynb`) demonstrating schema dump + sample queries + Plotly chart. Notebooks persist on the host at `notebooks/`; only the `examples/` directory is checked in. ([#607](https://github.com/brlauuu/podlog/issues/607))
- Subtle status indicator for the explore service at the bottom of the Meta-Analysis page. When the container is running, links to the Jupyter URL with a token-fetch hint; when not running, links to the explore guide in the docs. No start/stop UI controls — managed via `make explore` from the CLI by design. ([#607](https://github.com/brlauuu/podlog/issues/607))

### Fixes
- About page content column now aligns horizontally with the Docs page. Mirrors Docs's 3-column `[nav | content | toc]` grid at xl, with an empty placeholder where Docs has its left nav, so switching tabs no longer shifts the text. ([#620](https://github.com/brlauuu/podlog/issues/620))

## 0.3.2 — 2026-04-29

### Major changes
- Per-active-provider queue ETA in notifications. The "Est. time left" line in episode notifications now uses the rate of episodes processed by whichever inference provider is currently configured, and tags the line with `(local)` or `(remote)` so the basis is visible. ([#595](https://github.com/brlauuu/podlog/pull/595))
- Distinct error class for Fireworks upload rejections. When Fireworks aborts an upload at the TLS layer (typically size/duration cap), the failure is classified as `FIREWORKS_UPLOAD_REJECTED`, the retry loop is skipped, and notifications carry an "Action required: re-run on local inference" call-to-action. ([#602](https://github.com/brlauuu/podlog/pull/602))
- RAG / Ask is now an independently toggleable remote-inference step in Settings. Pick local Ollama or Fireworks AI from a curated list of chat models. The Ask page model dropdown re-renders to match the active provider and migrates any stale `localStorage` selection automatically. The Remote Inference section also gets an explicit privacy notice spelling out that data for any step set to remote (audio, transcripts, queries, retrieved chunks, embedding inputs) leaves the local machine. Default for new installs and existing upgrades remains local. ([#608](https://github.com/brlauuu/podlog/issues/608))

### Minor changes
- Copy-to-clipboard button for the episode UUID on the episode page. Subtle icon next to the title. ([#601](https://github.com/brlauuu/podlog/pull/601))
- "Releases" sidebar on `/about` (right rail, `xl:` and up) listing every changelog version with sticky scroll-spy. Header shows version count and the latest tagged release. (Superseded by the right-rail TOC redesign in 0.3.3.) ([#606](https://github.com/brlauuu/podlog/pull/606))
- Episode page tag strip now shows the same metadata tags as the episode card on the podcast page: language (with flag), Local/Remote inference provider, and a "No labels" warning when diarization didn't produce speaker labels. Speaker name tags remain on the card only. ([#609](https://github.com/brlauuu/podlog/issues/609))

### Fixes
- Default `FIREWORKS_CHAT_MODEL` updated from `accounts/fireworks/models/llama-v3p1-8b-instruct` (deprecated by Fireworks, would 404 out of the box) to `accounts/fireworks/models/qwen2p5-7b-instruct`. Aligned with the curated Ask-page dropdown. Existing installs with the env var set explicitly keep their value. ([#608](https://github.com/brlauuu/podlog/issues/608))
- Archive task now captures the tail of `ffmpeg`'s stderr when compression fails, instead of storing the placeholder `"ffmpeg error (see stderr output for detail)"`. ([#603](https://github.com/brlauuu/podlog/pull/603))
- CI Slow's web e2e job now runs `alembic upgrade head` against `db_test` before serving, fixing the `relation "feeds" does not exist` failure introduced when the SSR e2e specs landed. (commit `21629cb`)

### Internal
- Decoupled Ask/RAG generation from `inference_provider`: backend now reads a dedicated `rag_provider` runtime flag (default `local`). Previously, enabling Fireworks for transcription silently routed retrieved transcript chunks to Fireworks for answer generation too. Existing installs default to `local` so no behavior change on upgrade. Also surfaces a clean, actionable message (instead of leaking the raw provider response) when Fireworks returns 404 for a deprecated chat model. ([#608](https://github.com/brlauuu/podlog/issues/608))
- Periodic cleanup task that prunes superseded `failed` rows in `job_queue` (rows whose episode later succeeded). Runs every 24 h; clears noise from the queue dashboard's "failed" counter. ([#604](https://github.com/brlauuu/podlog/pull/604))
- New "Changelog" CI check fails any PR that doesn't touch `CHANGELOG.md`; opt out per-PR with the `no-changelog` label. ([#605](https://github.com/brlauuu/podlog/pull/605))

## 0.3.1 — 2026-04-26

### Minor changes
- Zod runtime validation for the settings response. ([#588](https://github.com/brlauuu/podlog/pull/588))
- Keyword search across docs. ([#589](https://github.com/brlauuu/podlog/pull/589))
- Filter podcast episodes list by speaker name. ([#593](https://github.com/brlauuu/podlog/pull/593))
- Format all dates as DD/MM/YYYY app-wide. ([#594](https://github.com/brlauuu/podlog/pull/594))

### Fixes
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
