# README Refresh Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Refresh `README.md` so it is accurate, minimal, and optimized for self-hosters evaluating Podlog, with current stack/version badges and test-status badges.

**Architecture:** Keep the implementation scoped to `README.md`. Replace the screenshot-led layout with a compact badge-forward technical brief, verify every claim against the repo manifests/docs/tests, and finish by validating markdown content plus opening a PR with the documentation changes.

**Tech Stack:** Markdown, Shields.io badges, Git, repo manifests (`package.json`, `pyproject.toml`, Compose files), and existing test commands from `Makefile`.

**Spec:** `docs/superpowers/specs/2026-04-05-readme-refresh-design.md`

---

## File Structure

- Modify: `README.md`
- Reference: `apps/web/package.json`
- Reference: `apps/pipeline/pyproject.toml`
- Reference: `docker-compose.yml`
- Reference: `docker-compose.test.yml`
- Reference: `Makefile`
- Reference: `docs/configuration.md`
- Reference: `docs/development.md`
- Reference: `docs/guide/README.md`
- Reference: `docs/hardware.md`
- Reference: `docs/episode-lifecycle.md`

---

### Task 1: Rewrite the README top section and content structure

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Confirm the values that will be baked into badges and summary copy**

Use these verified repo facts when rewriting:

```text
Web stack:
- Next.js ^14.2.0
- React ^18.3.0
- TypeScript ^5.4.0

Pipeline stack:
- Python >=3.11,<3.14
- FastAPI ^0.111.0
- PostgreSQL 15
- pgvector ^0.3.0

Runtime:
- 5 services in docker-compose.yml: db, pipeline, worker, ollama, web

Tests:
- 41 pipeline test files
- 12 web test files
- 338 detected test cases across apps/pipeline/tests and apps/web/tests
```

- [ ] **Step 2: Replace the current README structure with the new evaluator-focused layout**

The rewritten `README.md` should follow this shape:

```markdown
<div align="center">

# Podlog

**Self-hosted podcast transcription, diarization, search, and local AI Q&A**

[stack badges]
[test badges]

</div>

## What It Does

- ...

## Quick Start

```bash
git clone https://github.com/brlauuu/podlog.git
cd podlog
cp .env.example .env
# edit POSTGRES_PASSWORD and HF_TOKEN
make build
make up
```

## Requirements

- ...

## Runtime Overview

| Service | Tech | Purpose |
|---|---|---|

## Documentation

| Document | Description |
|---|---|

## Common Commands

```bash
make up
make down
make build
make logs
make test
make test-unit
make test-e2e
make shell-db
```

## Development

Short pointer to docs/development.md.

## License
```

- [ ] **Step 3: Use compact static badge URLs that reflect verified repo versions**

Use badges in this style, adjusting colors/labels as needed:

```markdown
![Next.js](https://img.shields.io/badge/Next.js-14.2-black?logo=next.js)
![React](https://img.shields.io/badge/React-18.3-149eca?logo=react&logoColor=white)
![FastAPI](https://img.shields.io/badge/FastAPI-0.111-009688?logo=fastapi&logoColor=white)
![Python](https://img.shields.io/badge/Python-3.11+-3776AB?logo=python&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-4169E1?logo=postgresql&logoColor=white)
![pgvector](https://img.shields.io/badge/pgvector-0.3-4B8BBE)
![Docker Compose](https://img.shields.io/badge/Docker_Compose-5_services-2496ED?logo=docker&logoColor=white)
![Tests](https://img.shields.io/badge/tests-338_defined-6A5ACD)
![Passing](https://img.shields.io/badge/passing-verified_in_session-informational)
```

If the tests are actually run in this session, replace the placeholder-style passing badge with a real passing count.

- [ ] **Step 4: Remove stale content rather than carrying it forward**

Delete or replace these outdated elements:

```text
- docs/screenshot-search.png image reference
- stale hardcoded passing-test badge/count
- oversized architecture ASCII block
- any copy that implies unverified counts or obsolete documentation layout
```

- [ ] **Step 5: Keep the self-hoster focus explicit**

Ensure the final copy emphasizes:

```text
- everything runs locally in Docker
- local PostgreSQL-backed queue instead of Redis/Celery
- local Ollama-backed Ask AI capability
- practical setup requirements
- links to deeper docs instead of contributor-heavy detail in the README body
```

- [ ] **Step 6: Review the final README content in the terminal**

Run:

```bash
sed -n '1,260p' README.md
```

Expected:

```text
- no screenshot reference
- no stale "398 passed" text
- new badge rows present
- quick start includes the required .env edit note
- documentation links point at existing files
```

---

### Task 2: Verify the documented test status and markdown integrity

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Run the supported fast verification commands**

Run:

```bash
rg -n "screenshot-search|398 passed|Tests]" README.md
find apps/pipeline/tests -type f \( -name 'test_*.py' -o -name '*_test.py' \) | wc -l
find apps/web/tests -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) | wc -l
rg -n "^(def test_|\s+def test_|test\(|it\()" apps/pipeline/tests apps/web/tests | wc -l
```

Expected:

```text
- no matches for removed stale README content
- counts still align with the values used in the README badges
```

- [ ] **Step 2: Run at least one project-supported test command if feasible in-session**

Preferred commands:

```bash
docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/ -v
docker compose -f docker-compose.test.yml run --rm web_test
```

Expected:

```text
- if both pass, update README badge text to a concrete passing count
- if they cannot be run or fail for environment reasons, keep the README wording honest and note the limitation in the final PR summary
```

- [ ] **Step 3: Confirm there are no unintended file changes**

Run:

```bash
git status --short
```

Expected:

```text
Only README.md and the planning/spec docs created for this work should appear.
```

---

### Task 3: Commit, push, and open the PR

**Files:**
- Modify: `README.md`
- Create: `docs/superpowers/specs/2026-04-05-readme-refresh-design.md`
- Create: `docs/superpowers/plans/2026-04-05-readme-refresh.md`

- [ ] **Step 1: Create a branch for the docs refresh**

Run:

```bash
git checkout -b docs/readme-refresh
```

Expected:

```text
Switched to a new branch named docs/readme-refresh
```

- [ ] **Step 2: Commit the changes with a docs-scoped message**

Run:

```bash
git add README.md docs/superpowers/specs/2026-04-05-readme-refresh-design.md docs/superpowers/plans/2026-04-05-readme-refresh.md
git commit -m "docs: refresh README for self-hosters"
```

Expected:

```text
A single commit containing the README refresh and its supporting spec/plan docs
```

- [ ] **Step 3: Push and open a PR**

Run:

```bash
git push -u origin docs/readme-refresh
```

Then open a PR titled:

```text
docs: refresh README for self-hosters
```

Use a body that summarizes:

```text
- removed the screenshot-led README layout
- updated the stack/version badges from current manifests
- updated test badges to current verified repo state
- tightened the README around self-hosting evaluation and current docs links
```

- [ ] **Step 4: Final verification note**

Before closing the task, capture:

```text
- whether tests were run and which commands passed
- exact branch name
- PR number/url
```
