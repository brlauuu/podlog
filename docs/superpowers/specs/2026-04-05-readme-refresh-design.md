# README Refresh Design Spec

**Date:** 2026-04-05
**Scope:** Refresh the repository root `README.md` for self-hosters evaluating Podlog. No product screenshot. Add a cleaner technical presentation with current stack/version badges and test-status badges derived from the actual repo state.

---

## Goals

- Make the top of the README useful for a self-hoster deciding whether to run Podlog
- Remove stale or misleading content from the current README
- Replace the screenshot-led presentation with a compact technical summary
- Show the actual primary frameworks and libraries used, with versions
- Show test inventory and pass status in a visible badge row
- Keep contributor-oriented details present but lower on the page or linked out

## Non-Goals

- No broad documentation rewrite outside `README.md`
- No new screenshots, GIFs, or demo media
- No generated badge service integration that requires runtime scripts
- No attempt to turn the README into marketing copy

## Current Problems

- The README still includes `docs/screenshot-search.png`, which is explicitly unwanted.
- The test badge is stale and hardcoded.
- The documentation table predates the current docs layout and emphasis.
- Some stack descriptions are too broad or hand-maintained instead of being anchored to the manifests in:
  - `apps/web/package.json`
  - `apps/pipeline/pyproject.toml`
  - `docker-compose.yml`
  - `docker-compose.test.yml`

## Audience and Tone

Primary audience: self-hosters evaluating whether Podlog is worth running locally.

Tone requirements:

- minimal
- technical
- direct
- trustworthy
- low-hype

The README should read like an operator-facing technical brief, not a landing page.

## Information Architecture

The refreshed README should use this order:

1. Centered title block
2. One-line product description
3. Badge rows
4. Short “What It Does” bullets
5. Quick Start
6. Requirements
7. Runtime Overview
8. Documentation
9. Common Commands
10. Development
11. License

## Hero Block

The top section should contain:

- `Podlog`
- one short sentence describing it as a self-hosted local podcast transcription and search stack
- no screenshot
- no feature collage
- no large architecture diagram at the top

The current ASCII architecture diagram can either be removed entirely or compressed into the later Runtime Overview section. For this refresh, a short runtime table is preferred over the large diagram to keep the page tighter.

## Badge Design

Use badge rows directly under the title/description.

### Stack badges

Show the core technologies that matter to a self-hoster evaluating the stack:

- Next.js
- React
- FastAPI
- PostgreSQL
- pgvector
- Docker Compose
- Python
- Node.js

Version source of truth:

- `apps/web/package.json`
- `apps/pipeline/pyproject.toml`
- `docker-compose.yml`

Badge values should reflect the major or explicit version actually declared in repo manifests. They do not need to pin transitive or image patch versions beyond what the repo itself declares.

### Test badges

Show:

- total test count
- passing test count
- optionally suite split if it stays compact

The values should be updated to current repo reality during implementation by inspecting the test files and running the supported test commands where feasible.

If a full passing count cannot be re-verified in this session, prefer an explicit label such as:

- `tests: <count> defined`
- `verified: <count> passing`

Do not claim a passing count that was not checked.

## Content Sections

### What It Does

Use 5-7 short bullets focused on evaluator value, for example:

- local RSS ingestion and episode management
- Whisper-based transcription
- speaker diarization and label management
- keyword and semantic transcript search
- per-episode AI question answering via local Ollama
- persistent audio playback with timestamp linking
- queue visibility and retry/reprocess workflows

Bullets should describe actual delivered behavior already present in the repo.

### Quick Start

Keep the fastest viable path:

```bash
git clone https://github.com/brlauuu/podlog.git
cd podlog
cp .env.example .env
make build
make up
```

Follow with:

- open `http://localhost:3000`
- note that first run downloads model weights and can take time

If `.env` editing is still required before boot because `POSTGRES_PASSWORD` and `HF_TOKEN` are mandatory, say that explicitly and keep the commands honest.

### Requirements

Call out only the prerequisites that matter for a self-hosted evaluation:

- Docker with Compose V2
- HuggingFace token
- pyannote license acceptance
- enough disk/RAM for first-run model download and processing
- Ollama requirement or optionality for Ask AI, based on current compose stack

### Runtime Overview

Replace the big architecture diagram with a concise table:

| Service | Tech | Purpose |
|---|---|---|
| `web` | Next.js | UI, search, episode pages |
| `pipeline` | FastAPI | control-plane API |
| `worker` | Python | ingestion, transcription, diarization, embeddings |
| `db` | PostgreSQL + pgvector | storage, FTS, queue, vector search |
| `ollama` | Ollama | local LLM for Ask AI |

Include one short sentence noting that the stack runs as five containers and uses PostgreSQL for queueing rather than Redis/Celery.

### Documentation

Trim the section to the documents a self-hoster is most likely to need first:

- guide index
- configuration reference
- hardware guide
- development guide
- episode lifecycle if it adds operator value

Use the current `docs/` layout, not the older broader table copy.

### Common Commands

Keep only the most useful commands from `Makefile`:

- `make up`
- `make down`
- `make build`
- `make logs`
- `make test`
- `make test-unit`
- `make test-e2e`
- `make shell-db`

### Development

This should be short and defer to `docs/development.md`.
The README is not the primary contributor manual for this pass.

### License

Retain:

- O'Saasy license link
- independent pyannote license acceptance note
- copyright/compliance reminder

## Accuracy Rules

The implementation must verify and align README statements against:

- `README.md` current content
- `Makefile`
- `docs/`
- `apps/web/package.json`
- `apps/pipeline/pyproject.toml`
- `docker-compose.yml`
- `docker-compose.test.yml`
- current test inventory and any test run performed during this task

Stale counts or capabilities should be removed rather than guessed.

## Visual Direction

- cleaner badge-forward layout
- less vertical sprawl above the fold
- no screenshot
- no decorative ASCII block unless it earns its space
- use short sections and compact tables

The target impression is: “small, local, technically coherent system.”

## Implementation Notes

- Editing scope should stay limited to `README.md` unless a linked doc path is clearly broken and needs a small fix.
- Badge URLs can use Shields.io static labels; no extra tooling is required.
- If exact pass counts are validated by running tests, the README can present them as passing badges.
- If only inventory counts are validated, the README should distinguish between defined tests and verified passing tests.

## Risks

- Test counts can drift quickly if hardcoded without verification.
- Overstating Ask AI requirements or readiness would hurt evaluator trust.
- Keeping too much contributor detail high in the README would dilute the self-hosting focus.

## Acceptance Criteria

- `README.md` no longer contains the screenshot reference
- top section is shorter and more technical than the current version
- stack badges show current major/declared versions from repo manifests
- test badges reflect verified current state without overclaiming
- quick start and requirements are accurate to the current repo
- documentation links match the actual `docs/` tree
- the README is clearly optimized for self-hosters evaluating the project
