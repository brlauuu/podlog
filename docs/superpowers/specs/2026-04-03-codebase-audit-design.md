# Codebase Audit Skill Design Spec

**Date:** 2026-04-03
**Scope:** A Claude Code skill that performs a comprehensive, automated audit of the Podlog repository. Runs locally, dispatches parallel subagents for each audit domain, writes a dated report, and creates GitHub issues for high-severity findings.

---

## Overview

A skill invoked via `/codebase-audit` that acts as an orchestrator. It dispatches 7 independent subagents in parallel — each focused on one audit domain — then merges their findings into a structured report. Designed to run unattended overnight in an isolated git worktree, with all outputs persisted as a committed report file and GitHub issues.

## Architecture

### Orchestrator Pattern

The skill file (`~/.claude/skills/codebase-audit/SKILL.md`) defines the orchestrator logic. It does not perform analysis itself — it dispatches subagents, collects results, and handles output.

```
Orchestrator
├── Create report file with "Status: IN PROGRESS (0/7)"
├── Dispatch 7 parallel subagents (Agent tool)
│   ├── architecture-review
│   ├── docs-freshness
│   ├── test-coverage
│   ├── dead-code-detection
│   ├── wizard-completeness
│   ├── claude-md-accuracy
│   └── dependency-health
├── As each completes: append section to report, update status (N/7), git commit
├── Write summary header with severity counts
├── Create GitHub issues for CRITICAL and WARNING findings
├── Update status to "COMPLETE (7/7 checks finished, N issues created)"
└── Final commit + push
```

### Worktree Isolation

The audit runs in its own git worktree (via `--worktree` CLI flag). This isolates the audit from any in-progress work in the main working tree. Test runs, coverage artifacts, and intermediate files stay contained. After the final push, the worktree is cleaned up — all durable artifacts live in the committed report and GitHub issues.

### Incremental Writes

Each subagent's findings are appended to the report and committed as they complete. If the session is interrupted mid-audit, completed sections are already committed and pushed. On the next run, the orchestrator starts fresh (each report is date-stamped).

## Severity Levels

| Level | Meaning | Auto-creates issue? |
|---|---|---|
| **CRITICAL** | Broken tests, README/docs claims that contradict code, missing files referenced in docs | Yes |
| **WARNING** | Low test coverage (<60%), outdated major dependency versions, confirmed dead files | Yes |
| **INFO** | Minor staleness, coverage below ideal but above threshold, structural suggestions | No (report only) |

## Audit Checks (Subagents)

### 1. Architecture Review

**Focus:** File structure, import graph, unnecessary files.

- Scan `apps/pipeline/app/` and `apps/web/src/` directory trees
- Identify files with no inbound imports (not imported by anything else)
- Check for circular dependencies in import graph
- Flag files >500 lines as candidates for splitting
- Compare actual file structure against CLAUDE.md "Repo Structure" section
- Exclude known entry points from "not imported" analysis: `main.py`, `page.tsx`, `layout.tsx`, `route.ts`, config files, test files

**Returns:** List of findings with file paths and severity.

### 2. Docs Freshness

**Focus:** Do docs match reality?

- Compare `README.md` feature list against actual code — does each claimed feature exist?
- Check `README.md` badge values (test count, Python version, Node version, PostgreSQL version) against `pyproject.toml`, `package.json`, `docker-compose.yml`
- For each `docs/guide/*.md` file: verify referenced UI routes, components, API endpoints, and CLI commands still exist
- Check PRD "Current State" / "Done" / "Not yet done" sections against actual implementation
- Check `docs/development.md`, `docs/configuration.md`, `docs/hardware.md` for stale references

**Returns:** List of stale claims with file:line, what the doc says, and what's actually true.

### 3. Test Coverage

**Focus:** Run actual test suites and parse coverage output.

- Run `cd apps/pipeline && python -m pytest --cov=app --cov-report=term-missing -q` and parse output
- Run `cd apps/web && npx jest --coverage --silent` and parse output
- Extract: overall coverage %, per-file coverage %, uncovered line ranges
- Flag files with 0% coverage as WARNING
- Flag overall coverage below 60% as CRITICAL
- Flag overall coverage between 60-80% as WARNING

**Returns:** Coverage summary table, list of uncovered files, critical gaps.

### 4. Dead Code Detection

**Focus:** Files and exports that nothing references.

- For each `.py` file in `apps/pipeline/app/`: grep the entire codebase for imports of its module name or function names
- For each `.ts`/`.tsx` file in `apps/web/src/`: grep for import references
- Check for unused exports (exported but never imported elsewhere)
- Check for orphaned test files that test modules/components no longer existing
- Exclude entry points: `main.py`, `page.tsx`, `layout.tsx`, `route.ts`, `conftest.py`, config files, `__init__.py`
- Exclude files only referenced dynamically (Celery tasks loaded by name, Next.js file-based routing)

**Returns:** List of likely dead files/exports with evidence (grep found zero references).

### 5. Wizard Completeness

**Focus:** Two-directional check — spec compliance and feature coverage gaps.

**Spec compliance:**
- Read `docs/superpowers/specs/2026-04-03-first-run-wizard-design.md`
- For each spec requirement, verify it exists in the implementation:
  - 3 screens implemented (health, add feed, complete)
  - Health polling via React Query at 3s interval
  - Feed adding with mode selector (test/selective/full)
  - Episode preview for selective mode
  - Help menu with "Setup Wizard" and "User Guide" items
  - Auto-show logic (fetch wizard status on mount, show if not completed)
  - "Don't show this wizard on next visit" checkbox
  - Skip buttons on every screen
  - Two variants of Screen 3 (feed added vs skipped)

**Feature coverage gaps:**
- Scan the codebase for user-facing features: routes in `apps/web/src/app/`, major components, API endpoints
- For each feature, check whether the wizard mentions, explains, or links to it
- Flag features that exist but aren't represented in the wizard (e.g., search functionality, queue purpose, RAG search when added, notification settings)
- Consider which features would benefit new users if explained during onboarding

**Returns:** Spec compliance checklist (pass/fail/partial) + list of features missing from wizard with rationale for inclusion.

### 6. CLAUDE.md Accuracy

**Focus:** Is CLAUDE.md telling the truth?

- **Repo Structure:** Verify every listed path in the tree diagram exists on disk
- **Current State — Done:** For each "done" item, verify the code/files actually exist
- **Current State — Not yet done:** For each "not yet done" item, check if it's actually been done since (e.g., lock files may now exist, migrations may have been generated)
- **Conventions:** Spot-check naming conventions, import alias usage (`@/*`), test patterns against actual code
- **Tech Stack:** Compare listed versions against `pyproject.toml`, `package.json`, `docker-compose.yml`
- **How to Run:** Verify listed Makefile targets exist and services match docker-compose.yml

**Returns:** List of inaccuracies with "CLAUDE.md says X" vs "reality is Y".

### 7. Dependency Health

**Focus:** Package freshness and hygiene.

- Parse `apps/pipeline/pyproject.toml` dependencies
- Parse `apps/web/package.json` dependencies and devDependencies
- Run `cd apps/web && npm outdated --json` to check for outdated packages
- Check for dependencies listed but not imported anywhere in code (unused)
- Check for imports that reference packages not in dependency lists (missing)
- Flag major version gaps (e.g., listed `^5.0.0`, latest is `6.x`) as WARNING

**Returns:** Table of outdated packages (current vs latest), unused deps, missing deps.

## Output

### Report File

**Location:** `docs/audit/YYYY-MM-DD-audit.md`

**Structure:**

```markdown
# Codebase Audit — YYYY-MM-DD

> Status: COMPLETE (7/7 checks finished, N issues created)

## Summary
- Overall health: [Good / Needs Attention / Critical]
- Findings: N critical, M warnings, K informational
- Test coverage: pipeline X%, web Y%
- Issues created: N

## Architecture Review
[findings]

## Docs Freshness
[findings]

## Test Coverage
[coverage tables and gaps]

## Dead Code Detection
[unused files/exports]

## Wizard Completeness
### Spec Compliance
[checklist]
### Feature Coverage Gaps
[features not represented in wizard]

## CLAUDE.md Accuracy
[inaccuracies]

## Dependency Health
[outdated, unused, missing]
```

Each finding within a section uses this format:

```markdown
- **[CRITICAL]** README claims 155 tests but pytest reports 142
  - File: README.md:15
  - Evidence: `pytest --co -q | tail -1` → "142 tests collected"

- **[WARNING]** `apps/web/src/lib/search.ts` has 0% test coverage
  - 87 lines uncovered

- **[INFO]** `apps/pipeline/app/services/alignment.py` — no inbound imports detected
  - May be dead code or only used dynamically
```

### GitHub Issues

Auto-created for CRITICAL and WARNING findings. Each issue gets:

- **Label:** `codebase-audit`
- **Title:** `[Audit] <one-line description>`
- **Body:**
  ```markdown
  ## Finding

  <finding detail from report>

  ## Evidence

  <evidence from subagent>

  ## Source

  From [codebase audit report](docs/audit/YYYY-MM-DD-audit.md), section: <section name>
  ```

Issues are created via `gh issue create`. The `codebase-audit` label is created if it doesn't exist.

## Invocation

### On-demand (interactive session)

```bash
# From within a Claude Code session:
/codebase-audit
```

### Unattended (overnight)

```bash
claude -p "/codebase-audit" \
  --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Agent" \
  --model opus \
  --worktree \
  --dangerously-skip-permissions \
  --print \
  > /tmp/audit-$(date +%Y-%m-%d).log 2>&1
```

### Cron (nightly at 2am)

```bash
# crontab -e
0 2 * * * cd /home/brlauuu/repos/podlog && claude -p "/codebase-audit" --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Agent" --model opus --worktree --dangerously-skip-permissions --print > /tmp/audit-$(date +\%Y-\%m-\%d).log 2>&1
```

### Required Tools

| Tool | Purpose |
|---|---|
| `Read` | Reading source files, configs, docs |
| `Glob` | Finding files by pattern |
| `Grep` | Searching for imports, references, patterns |
| `Bash` | Running tests, git commands, gh issue create, npm outdated |
| `Write` | Creating the report file |
| `Edit` | Updating the report incrementally |
| `Agent` | Dispatching parallel subagents |

## Skill File Structure

```
~/.claude/skills/
└── codebase-audit/
    └── SKILL.md    # Orchestrator logic + subagent prompts
```

Single file. All subagent prompts are inline in the SKILL.md. No supporting files needed.

## Relationship to Existing Skills

- **repo-cleanup:** Complementary, no overlap. repo-cleanup handles git hygiene and Docker waste. codebase-audit handles code quality and documentation accuracy.
- **code-review:** Different scope. code-review examines individual PRs. codebase-audit examines the whole repository.
- **issue-to-pr:** Downstream consumer. Issues created by codebase-audit can be picked up by issue-to-pr for implementation.

## Completion Tracking

The report includes a status line at the very top (below the title) that tracks progress:

- **On start:** `> Status: IN PROGRESS (0/7)`
- **After each subagent:** `> Status: IN PROGRESS (N/7)` — updated and committed incrementally
- **On successful completion:** `> Status: COMPLETE (7/7 checks finished, N issues created)`
- **If interrupted:** Status stays at whatever count was last committed, e.g., `> Status: IN PROGRESS (4/7)`

An interrupted report also implicitly shows which checks are missing — only completed sections appear in the file. The status line names which checks haven't run:

```markdown
> Status: INCOMPLETE (4/7 checks finished — missing: wizard-completeness, claude-md-accuracy, dependency-health)
```

**Where to check:**
1. **The report file on GitHub** — `docs/audit/YYYY-MM-DD-audit.md`, status line is the first thing you see
2. **The log file** — `/tmp/audit-YYYY-MM-DD.log` captures all stdout including the final status

## Error Handling

- **Test suite fails to run:** Report the error as a CRITICAL finding ("test suite failed to execute") with the error output. Don't block other checks.
- **gh not authenticated:** Skip issue creation, log a WARNING in the report summary ("GitHub issues not created — gh not authenticated").
- **Subagent returns empty/malformed output:** Log as INFO ("check returned no findings or failed"), continue with other checks.
- **Session interrupted mid-audit:** Completed sections are already committed. Next run starts fresh with a new date-stamped report.

## Worktree Lifecycle

1. CLI creates worktree via `--worktree` flag on startup
2. Audit runs entirely within the worktree
3. Report is committed and pushed to origin from the worktree
4. On session exit, CLI cleans up the worktree automatically
5. All durable artifacts: report file on `main` (via push), issues on GitHub

## Out of Scope

- Security vulnerability scanning (use `npm audit`, `safety` separately)
- Performance profiling
- Docker image size optimization
- Automated fixing of findings (that's the job of issue-to-pr)
- Historical trend tracking across audit runs
