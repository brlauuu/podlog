# Codebase Audit Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a Claude Code skill that performs comprehensive automated audits of the Podlog repository — dispatching parallel subagents, writing a dated report, and creating GitHub issues for high-severity findings.

**Architecture:** Single SKILL.md orchestrator file that dispatches 7 parallel subagents (one per audit domain), collects results incrementally into a report file, commits progressively, and creates GitHub issues for CRITICAL/WARNING findings. Runs in an isolated worktree.

**Tech Stack:** Claude Code skill (SKILL.md with YAML frontmatter), Bash (git, gh, pytest, jest), Agent tool for subagent dispatch.

---

## File Structure

```
Files to create:
  ~/.claude/skills/codebase-audit/SKILL.md          # The skill — orchestrator + subagent prompts
  docs/audit/.gitkeep                                # Ensure audit output directory exists in repo

Files to modify:
  docs/development.md                                # Add "Codebase Audit" section with invocation docs
```

---

### Task 1: Create the audit output directory

**Files:**
- Create: `docs/audit/.gitkeep`

- [ ] **Step 1: Create the directory and placeholder**

```bash
mkdir -p docs/audit
touch docs/audit/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add docs/audit/.gitkeep
git commit -m "chore: add docs/audit directory for codebase audit reports"
```

---

### Task 2: Create the SKILL.md orchestrator — frontmatter and overview

**Files:**
- Create: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Create the skill directory**

```bash
mkdir -p ~/.claude/skills/codebase-audit
```

- [ ] **Step 2: Write the frontmatter, overview, and orchestrator instructions**

Create `~/.claude/skills/codebase-audit/SKILL.md` with the following content. This is the skeleton that defines how the orchestrator works — subagent prompts will be added in subsequent tasks.

```markdown
---
name: codebase-audit
description: Use when performing a comprehensive repository audit — architecture review, docs freshness, test coverage, dead code detection, wizard completeness, CLAUDE.md accuracy, and dependency health. Invoke with /codebase-audit or run unattended overnight.
---

# Codebase Audit

Comprehensive automated audit of the repository. Dispatches 7 parallel subagents, writes a dated report to `docs/audit/`, and creates GitHub issues for high-severity findings.

## Severity Levels

| Level | Meaning | Auto-creates issue? |
|---|---|---|
| **CRITICAL** | Broken tests, README/docs claims that contradict code, missing referenced files | Yes |
| **WARNING** | Low test coverage (<60%), outdated major deps, confirmed dead files | Yes |
| **INFO** | Minor staleness, structural suggestions, coverage below ideal but above threshold | No |

## Finding Format

Every finding in the report MUST use this exact format:

```
- **[SEVERITY]** One-line description
  - File: path/to/file.ext:line (if applicable)
  - Evidence: what you checked and what you found
```

## Orchestrator Steps

Follow these steps exactly. Do not skip steps or reorder them.

### Step 1: Initialize Report

1. Get today's date:
   ```bash
   date +%Y-%m-%d
   ```
2. Create the report file at `docs/audit/YYYY-MM-DD-audit.md` with this initial content:
   ```markdown
   # Codebase Audit — YYYY-MM-DD

   > Status: IN PROGRESS (0/7)

   *Report is being generated. Sections appear as checks complete.*
   ```
3. Commit and push:
   ```bash
   git add docs/audit/YYYY-MM-DD-audit.md
   git commit -m "audit: start codebase audit YYYY-MM-DD"
   git push origin HEAD
   ```

### Step 2: Dispatch All 7 Subagents in Parallel

Dispatch all 7 agents in a SINGLE message using the Agent tool. Each agent gets `subagent_type: "general-purpose"`. Pass each agent its full prompt from the "Subagent Prompts" section below. Each agent returns its findings as markdown text.

The 7 agents to dispatch simultaneously:
1. **architecture-review** — "Analyze architecture"
2. **docs-freshness** — "Check docs freshness"
3. **test-coverage** — "Run test coverage"
4. **dead-code-detection** — "Detect dead code"
5. **wizard-completeness** — "Check wizard completeness"
6. **claude-md-accuracy** — "Verify CLAUDE.md"
7. **dependency-health** — "Check dependency health"

### Step 3: Collect Results Incrementally

As each subagent completes, immediately:

1. Append its section to the report file using the Edit tool
2. Update the status line: `> Status: IN PROGRESS (N/7)` where N is the count of completed checks
3. Commit and push:
   ```bash
   git add docs/audit/YYYY-MM-DD-audit.md
   git commit -m "audit: add [section-name] results"
   git push origin HEAD
   ```

If a subagent fails or returns empty results, append this to the report:
```markdown
## [Section Name]

- **[INFO]** Check returned no findings or failed to execute
```

### Step 4: Write Summary Header

After ALL 7 subagents have completed:

1. Count findings by severity across all sections (grep the report for `**[CRITICAL]**`, `**[WARNING]**`, `**[INFO]**`)
2. Determine overall health:
   - Any CRITICAL findings → "Critical"
   - Any WARNING but no CRITICAL → "Needs Attention"
   - Only INFO or no findings → "Good"
3. Insert the summary section right after the status line using Edit:
   ```markdown
   ## Summary
   - Overall health: [Good / Needs Attention / Critical]
   - Findings: N critical, M warnings, K informational
   - Test coverage: pipeline X%, web Y% (from test-coverage section)
   - Issues created: (pending — see Step 5)
   ```

### Step 5: Create GitHub Issues

1. First, ensure the `codebase-audit` label exists:
   ```bash
   gh label create codebase-audit --description "Automated codebase audit finding" --color "d93f0b" 2>/dev/null || true
   ```

2. For each CRITICAL and WARNING finding in the report, create an issue:
   ```bash
   gh issue create \
     --title "[Audit] <one-line finding description>" \
     --label "codebase-audit" \
     --body "$(cat <<'ISSUE_EOF'
   ## Finding

   <full finding text from report>

   ## Evidence

   <evidence line from finding>

   ## Source

   From codebase audit report `docs/audit/YYYY-MM-DD-audit.md`
   ISSUE_EOF
   )"
   ```

3. Update the summary line with the issue count: `- Issues created: N`

4. If `gh` fails (not authenticated), add to the summary:
   ```markdown
   - Issues created: 0 (gh not authenticated — create issues manually from findings above)
   ```

### Step 6: Finalize Report

1. Update the status line to:
   ```markdown
   > Status: COMPLETE (7/7 checks finished, N issues created)
   ```
2. Remove the "*Report is being generated*" placeholder if still present
3. Final commit and push:
   ```bash
   git add docs/audit/YYYY-MM-DD-audit.md
   git commit -m "audit: complete codebase audit YYYY-MM-DD"
   git push origin HEAD
   ```

---

## Subagent Prompts

(Subagent prompts will be added below)
```

- [ ] **Step 3: Verify the file was created**

```bash
cat ~/.claude/skills/codebase-audit/SKILL.md | head -5
```

Expected: the YAML frontmatter header.

- [ ] **Step 4: Commit**

```bash
git add docs/audit/.gitkeep
git commit -m "feat: add codebase-audit skill skeleton with orchestrator logic"
```

Note: The SKILL.md lives in `~/.claude/skills/` which is outside the repo, so it won't be git-tracked. That's correct — skills are user-level, not project-level. Only `docs/audit/.gitkeep` is committed to the repo.

---

### Task 3: Add subagent prompt — Architecture Review

**Files:**
- Modify: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Append the architecture-review subagent prompt**

Replace the `(Subagent prompts will be added below)` placeholder in SKILL.md with the first subagent prompt. Use the Edit tool to replace:

Old: `(Subagent prompts will be added below)`

New:

````markdown
### Subagent 1: Architecture Review

**Agent description:** "Analyze architecture"

**Prompt:**

```
You are auditing the Podlog repository's architecture. Your job is to identify structural issues. Report findings in this exact format:

- **[SEVERITY]** One-line description
  - File: path/to/file.ext:line
  - Evidence: what you checked and what you found

SEVERITY is one of: CRITICAL, WARNING, INFO

## Checks to perform:

### 1. File structure vs CLAUDE.md
Read CLAUDE.md and find the "Repo Structure" tree diagram. For every path listed in that tree, use Glob to verify it exists on disk. Report any paths that are listed but don't exist as CRITICAL.

### 2. Orphan files (no inbound imports)
For each .py file in apps/pipeline/app/ (recursively), grep the entire apps/pipeline/ directory for imports of that module. Exclude these from the "orphan" check — they are entry points or special files:
- main.py, worker.py, config.py, database.py, __init__.py, conftest.py
- Any file inside alembic/
- Any file inside tests/

For each .ts/.tsx file in apps/web/src/ (recursively), grep apps/web/src/ for imports of that file. Exclude:
- page.tsx, layout.tsx, route.ts (Next.js file-based routing)
- globals.css, jest.setup.ts
- Any file inside tests/

Report files with zero inbound imports as INFO (they may be dynamically loaded).

### 3. Large files
Use wc -l on all .py, .ts, and .tsx files. Flag any file over 500 lines as INFO with the line count.

### 4. Circular dependencies
For each import found in step 2, check if the imported module also imports the importer. Report any circular pairs as WARNING.

Return ONLY the findings in the format above. If no findings, return "No architecture issues found."
```
````

- [ ] **Step 2: Verify the edit**

```bash
grep "Subagent 1: Architecture Review" ~/.claude/skills/codebase-audit/SKILL.md
```

Expected: line found.

---

### Task 4: Add subagent prompt — Docs Freshness

**Files:**
- Modify: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Append the docs-freshness subagent prompt after the architecture-review prompt**

Add to SKILL.md after the architecture-review subagent section:

````markdown
### Subagent 2: Docs Freshness

**Agent description:** "Check docs freshness"

**Prompt:**

```
You are auditing the Podlog repository's documentation for staleness. Report findings in this exact format:

- **[SEVERITY]** One-line description
  - File: path/to/file.ext:line
  - Evidence: what the doc claims vs what's actually true

SEVERITY is one of: CRITICAL, WARNING, INFO

## Checks to perform:

### 1. README.md feature claims
Read README.md. For each feature listed in the "Features" section, verify the feature exists in the codebase:
- "Hybrid search" → check for apps/web/src/lib/search.ts or similar
- "Speaker diarization" → check for pyannote service code
- "Persistent audio player" → check for AudioPlayer component
- etc.
Report features claimed but not implemented as CRITICAL.

### 2. README.md badges
Read README.md badge lines. Check:
- Python version badge: compare against apps/pipeline/pyproject.toml `python = ` line
- Node.js version badge: compare against apps/web/package.json `engines` or Dockerfile
- PostgreSQL version badge: compare against docker-compose.yml postgres image tag
- Test count badge: run `cd apps/pipeline && python -m pytest tests/unit/ --co -q 2>/dev/null | tail -1` and `cd apps/web && npx jest --listTests 2>/dev/null | wc -l` — compare total against badge number
Report mismatches as WARNING.

### 3. Guide files
For each file in docs/guide/*.md:
- Extract any route references (e.g., /queue, /podcasts, /episodes) and verify the route exists in apps/web/src/app/
- Extract any component references and verify they exist in apps/web/src/components/
- Extract any API endpoint references and verify they exist in apps/web/src/app/api/ or apps/pipeline/app/api/
- Extract any CLI/make command references and verify they exist in the Makefile
Report missing references as WARNING.

### 4. PRD current state
Read each file in prds/. Look for sections titled "Current State", "Done", "Not yet done", or similar status tracking. For "Done" items, spot-check 3-5 by verifying the code exists. For "Not yet done" items, check if any have actually been completed.
Report stale status as INFO.

### 5. Other docs
Read docs/development.md, docs/configuration.md, docs/hardware.md. Check for references to files, commands, or structures that no longer exist.
Report stale references as WARNING.

Return ONLY the findings in the format above. If no findings, return "No docs freshness issues found."
```
````

- [ ] **Step 2: Verify**

```bash
grep "Subagent 2: Docs Freshness" ~/.claude/skills/codebase-audit/SKILL.md
```

---

### Task 5: Add subagent prompt — Test Coverage

**Files:**
- Modify: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Append the test-coverage subagent prompt**

````markdown
### Subagent 3: Test Coverage

**Agent description:** "Run test coverage"

**Prompt:**

```
You are auditing the Podlog repository's test coverage. You must RUN the actual test suites and parse the output. Report findings in this exact format:

- **[SEVERITY]** One-line description
  - File: path/to/file.ext
  - Evidence: coverage % or error message

SEVERITY is one of: CRITICAL, WARNING, INFO

## Checks to perform:

### 1. Pipeline coverage
Run:
```bash
cd apps/pipeline && python -m pytest tests/unit/ --cov=app --cov-report=term-missing -q 2>&1
```

Parse the output. Extract:
- Overall coverage percentage (last line of coverage report)
- Per-file coverage percentages
- Files with 0% coverage
- Uncovered line ranges for files below 60%

If the command fails (missing dependencies, import errors), report the error as:
- **[CRITICAL]** Pipeline test suite failed to execute
  - Evidence: <first 5 lines of error output>

### 2. Web coverage
Run:
```bash
cd apps/web && npx jest --coverage --silent 2>&1
```

Parse the output. Same extraction as pipeline.

If the command fails, report similarly as CRITICAL.

### 3. Classify findings
- Overall coverage below 60% → CRITICAL
- Overall coverage 60-80% → WARNING
- Individual files with 0% coverage → WARNING
- Individual files 60-80% → INFO
- Coverage above 80% → no finding needed

### 4. Format output
Start your response with a summary table:

```
### Coverage Summary

| Component | Coverage | Status |
|-----------|----------|--------|
| Pipeline  | XX%      | [severity] |
| Web       | XX%      | [severity] |
```

Then list individual file findings below.

Return ONLY the summary table and findings in the format above.
```
````

- [ ] **Step 2: Verify**

```bash
grep "Subagent 3: Test Coverage" ~/.claude/skills/codebase-audit/SKILL.md
```

---

### Task 6: Add subagent prompt — Dead Code Detection

**Files:**
- Modify: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Append the dead-code-detection subagent prompt**

````markdown
### Subagent 4: Dead Code Detection

**Agent description:** "Detect dead code"

**Prompt:**

```
You are auditing the Podlog repository for dead code — files and exports that nothing references. Report findings in this exact format:

- **[SEVERITY]** One-line description
  - File: path/to/file.ext
  - Evidence: what you searched for and the result

SEVERITY is one of: CRITICAL, WARNING, INFO

## Checks to perform:

### 1. Python dead files
List all .py files in apps/pipeline/app/ recursively using Glob with pattern "apps/pipeline/app/**/*.py".

For each file, determine its module name (e.g., apps/pipeline/app/services/alignment.py → alignment or services.alignment).

Skip these files — they are entry points or special:
- __init__.py, main.py, worker.py, config.py, database.py, scheduler.py, conftest.py
- Files in alembic/ directory
- Files in tests/ directory

For remaining files, use Grep to search the entire apps/pipeline/ directory for:
- `from app.MODULE_PATH import` or `import app.MODULE_PATH`
- `from .MODULE_NAME import` or `import .MODULE_NAME`

If zero references found, report as WARNING (confirmed dead file).

### 2. TypeScript/React dead files
List all .ts and .tsx files in apps/web/src/ recursively using Glob.

Skip these files — they are Next.js entry points or special:
- page.tsx, layout.tsx, route.ts, loading.tsx, error.tsx, not-found.tsx
- globals.css, jest.setup.ts
- Files in tests/ directory

For remaining files, extract the filename without extension. Use Grep to search apps/web/src/ for:
- `from ".*FILENAME"` or `from '.*FILENAME'`
- `import .* from ".*FILENAME"` or `import .* from '.*FILENAME'`

If zero references found, report as WARNING.

### 3. Orphaned test files
List all test files (apps/pipeline/tests/**/*.py and apps/web/tests/**/*.test.{ts,tsx}).

For each test file, identify what it's testing from the filename (e.g., test_alignment.py tests alignment.py, setup-wizard.test.tsx tests SetupWizard.tsx).

Check if the tested file still exists. If not, report as WARNING (orphaned test).

### 4. Unused exports (TypeScript only)
For each .ts file in apps/web/src/lib/, use Grep to find all `export` statements. For each exported name, grep the rest of apps/web/src/ for usage. Report unused exports as INFO.

Return ONLY the findings. If no findings, return "No dead code detected."
```
````

- [ ] **Step 2: Verify**

```bash
grep "Subagent 4: Dead Code Detection" ~/.claude/skills/codebase-audit/SKILL.md
```

---

### Task 7: Add subagent prompt — Wizard Completeness

**Files:**
- Modify: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Append the wizard-completeness subagent prompt**

````markdown
### Subagent 5: Wizard Completeness

**Agent description:** "Check wizard completeness"

**Prompt:**

```
You are auditing the Podlog first-run setup wizard for completeness. Two checks: does the implementation match the spec, and are there features missing from the wizard that should be included? Report findings in this exact format:

- **[SEVERITY]** One-line description
  - File: path/to/file.ext:line
  - Evidence: what you checked and what you found

SEVERITY is one of: CRITICAL, WARNING, INFO

## Checks to perform:

### 1. Spec compliance
Read the wizard spec at docs/superpowers/specs/2026-04-03-first-run-wizard-design.md.

Then read each implementation file and verify these requirements:

**SetupWizard.tsx (or equivalent main wizard component):**
- [ ] Uses Radix Dialog for overlay
- [ ] Has 3 screens/steps
- [ ] Has skip button on every screen
- [ ] Prevents pointer-down-outside dismissal
- [ ] Step dots navigation at bottom

**WizardHealthCheck.tsx (Screen 1):**
- [ ] Title: "Welcome to Podlog"
- [ ] Shows 3 service statuses (Database, Pipeline API, Worker)
- [ ] Polls /api/pipeline/health every 3 seconds via React Query
- [ ] Shows progress bar when worker is WARMING_UP
- [ ] "Next" button always enabled

**WizardAddFeed.tsx (Screen 2):**
- [ ] Feed URL text input
- [ ] Mode selector with 3 options (Test, Selective, Full)
- [ ] Test mode pre-selected
- [ ] Selective mode shows episode picker via /api/feeds/preview
- [ ] "Skip — I'll explore first" button

**WizardComplete.tsx (Screen 3):**
- [ ] Two variants (feed added vs skipped)
- [ ] Feed added: "You're All Set!" title
- [ ] Feed skipped: "Ready When You Are" title
- [ ] Link cards for Search, Queue, etc.
- [ ] "Don't show this wizard on next visit" checkbox
- [ ] No emojis anywhere

**HelpMenu.tsx:**
- [ ] "?" icon button
- [ ] Dropdown with "Setup Wizard" and "User Guide" items
- [ ] "Setup Wizard" opens the wizard

**WizardProvider.tsx:**
- [ ] Fetches /api/wizard/status on mount
- [ ] Auto-opens wizard if not completed
- [ ] Fail-open (shows wizard if status check fails)

**API route (api/wizard/status/route.ts):**
- [ ] GET returns { completed: boolean }
- [ ] PUT accepts { completed: boolean }
- [ ] Uses system_state table with wizard_completed key

Report missing or incorrect implementations as CRITICAL. Report partial implementations as WARNING.

### 2. Feature coverage gaps
Scan for user-facing features by:
1. List all route directories in apps/web/src/app/ (each directory = a page/feature)
2. List major components in apps/web/src/components/
3. List API endpoints in apps/web/src/app/api/

For each feature, check if the wizard mentions, explains, or links to it anywhere in the wizard components. Features to specifically check:
- Search functionality (how hybrid search works, what query syntax is supported)
- Queue page (what it shows, what processing stages mean)
- Podcast/feed management (beyond just adding the first feed)
- Episode detail page
- Speaker renaming
- Notification settings
- Audio playback controls
- Dark/light theme
- RAG/semantic search (if it exists in the codebase)

Report features that exist but aren't mentioned in the wizard as INFO with a recommendation for whether they should be added.

Return the spec compliance checklist AND the feature gap findings.
```
````

- [ ] **Step 2: Verify**

```bash
grep "Subagent 5: Wizard Completeness" ~/.claude/skills/codebase-audit/SKILL.md
```

---

### Task 8: Add subagent prompt — CLAUDE.md Accuracy

**Files:**
- Modify: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Append the claude-md-accuracy subagent prompt**

````markdown
### Subagent 6: CLAUDE.md Accuracy

**Agent description:** "Verify CLAUDE.md"

**Prompt:**

```
You are auditing CLAUDE.md to verify it accurately describes the current state of the Podlog repository. Report findings in this exact format:

- **[SEVERITY]** One-line description
  - File: CLAUDE.md:line (and the file it references)
  - Evidence: what CLAUDE.md claims vs what's actually true

SEVERITY is one of: CRITICAL, WARNING, INFO

## Checks to perform:

### 1. Repo Structure tree
Read CLAUDE.md and find the repo structure tree diagram. For EVERY path shown in the tree:
- Use Glob or Bash `ls` to verify it exists
- If a directory is shown, verify it contains the types of files described
Report missing paths as CRITICAL. Report paths that exist but contain different content than described as WARNING.

### 2. Tech Stack table
Read the Tech Stack table. For each row:
- Check the version/technology matches what's in pyproject.toml, package.json, or docker-compose.yml
- E.g., if it says "PostgreSQL 15", check the postgres image tag in docker-compose.yml
- If it says "Next.js 14", check the next version in package.json
Report version mismatches as WARNING.

### 3. Current State — Done items
Read the "Done" list under "Current State & What's Next". For each item:
- "Full project scaffold committed" → verify key files exist
- "SQLAlchemy models with all fields" → read apps/pipeline/app/models.py, verify it has models
- "All Celery task implementations" → check apps/pipeline/app/tasks/ for task files
- "All FastAPI endpoints" → check apps/pipeline/app/api/ for router files
- "All Next.js pages, API routes, and components" → check apps/web/src/app/ and apps/web/src/components/
- "Unit test stubs" → check test directories
Report items marked as done that aren't actually done as CRITICAL.

### 4. Current State — Not yet done items
Read the "Not yet done" list. For each item:
- "First Alembic migration" → check if alembic/versions/ has any .py files
- "npm install / poetry lock" → check if package-lock.json and poetry.lock exist
- "Docker build smoke test" → check git log for evidence of Docker builds
- "Integration and e2e tests" → check if test bodies are still `pytest.skip` or have real implementations
- "shadcn/ui components not yet installed" → check if shadcn components exist in the codebase
Report items marked as "not yet done" that have actually been done as WARNING (CLAUDE.md is stale).

### 5. Conventions spot-check
Read the Conventions section. Spot-check:
- "Ruff for linting" → verify ruff config exists in pyproject.toml
- "@/* path alias" → verify tsconfig.json has this alias
- "strict mode" → verify tsconfig.json has strict: true
Report convention claims that don't match reality as WARNING.

### 6. How to Run
Read the "How to Run" section. Verify:
- Each listed make target exists in the Makefile
- Service names match docker-compose.yml
- Port numbers match docker-compose.yml
Report mismatches as WARNING.

Return ONLY the findings. If no findings, return "CLAUDE.md is accurate."
```
````

- [ ] **Step 2: Verify**

```bash
grep "Subagent 6: CLAUDE.md Accuracy" ~/.claude/skills/codebase-audit/SKILL.md
```

---

### Task 9: Add subagent prompt — Dependency Health

**Files:**
- Modify: `~/.claude/skills/codebase-audit/SKILL.md`

- [ ] **Step 1: Append the dependency-health subagent prompt**

````markdown
### Subagent 7: Dependency Health

**Agent description:** "Check dependency health"

**Prompt:**

```
You are auditing the Podlog repository's dependency health. Report findings in this exact format:

- **[SEVERITY]** One-line description
  - File: path/to/file.ext
  - Evidence: current version vs latest, or import details

SEVERITY is one of: CRITICAL, WARNING, INFO

## Checks to perform:

### 1. Outdated npm packages
Run:
```bash
cd apps/web && npm outdated --json 2>/dev/null
```

Parse the JSON output. For each outdated package:
- Major version bump (e.g., 14.x → 15.x) → WARNING
- Minor/patch only → INFO
- If npm outdated fails, report as INFO and continue

### 2. Python dependency versions
Read apps/pipeline/pyproject.toml. List all dependencies with their version constraints.
Check if poetry.lock exists. If it does, compare locked versions against constraints.
If poetry.lock doesn't exist, report as WARNING ("no lock file — dependency versions not pinned").

### 3. Unused npm dependencies
Read apps/web/package.json. For each dependency in "dependencies" and "devDependencies":
- Use Grep to search apps/web/src/ for imports of that package name
- Also check jest.config.ts, next.config.js, tailwind.config.ts, postcss.config.js for references
- Skip @types/ packages (they're used implicitly by TypeScript)
- Skip postcss, autoprefixer, tailwindcss (used via config, not imports)
Report packages with zero references as WARNING (likely unused).

### 4. Unused Python dependencies
Read apps/pipeline/pyproject.toml. For each dependency under [tool.poetry.dependencies]:
- Use Grep to search apps/pipeline/ for imports of that package (use the import name, which may differ from the package name — e.g., package "psycopg2-binary" is imported as "psycopg2")
- Skip python itself
- Known import name mappings: psycopg2-binary→psycopg2, pydantic-settings→pydantic_settings, ffmpeg-python→ffmpeg, pyannote-audio→pyannote, sentence-transformers→sentence_transformers
Report packages with zero import references as WARNING.

### 5. Missing dependencies
Use Grep to find all import statements in apps/pipeline/app/:
```bash
grep -rh "^import \|^from " apps/pipeline/app/ | sort -u
```
And in apps/web/src/:
```bash
grep -rh "^import " apps/web/src/ | sort -u
```
For each imported package that is NOT a relative import and NOT a stdlib module, verify it appears in the respective dependency file.
Report missing dependencies as CRITICAL.

Return ONLY the findings. If no findings, return "All dependencies are healthy."
```
````

- [ ] **Step 2: Verify the complete SKILL.md has all 7 subagent prompts**

```bash
grep -c "^### Subagent" ~/.claude/skills/codebase-audit/SKILL.md
```

Expected output: `7`

- [ ] **Step 3: Commit the docs/audit directory**

```bash
git add docs/audit/.gitkeep
git commit -m "feat: add codebase-audit skill with 7 audit checks

Skill dispatches parallel subagents for: architecture review, docs
freshness, test coverage, dead code detection, wizard completeness,
CLAUDE.md accuracy, and dependency health. Writes dated report to
docs/audit/ and creates GitHub issues for high-severity findings."
```

---

### Task 10: Add invocation docs to docs/development.md

**Files:**
- Modify: `docs/development.md`

- [ ] **Step 1: Read the current end of docs/development.md**

```bash
tail -20 docs/development.md
```

Verify the file ends after the "Conventions" section.

- [ ] **Step 2: Append the codebase audit section**

Use the Edit tool to add the following at the end of `docs/development.md`:

```markdown

## Codebase Audit

Automated comprehensive audit that checks architecture, documentation freshness, test coverage, dead code, wizard completeness, CLAUDE.md accuracy, and dependency health.

### On-demand (interactive)

From within a Claude Code session:

```
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

**Flags explained:**
- `--allowedTools` — Read/Glob/Grep for analysis, Bash for running tests and git/gh, Write/Edit for the report, Agent for parallel subagents
- `--model opus` — uses Opus for highest quality analysis
- `--worktree` — runs in an isolated git worktree (safe, won't touch your working directory)
- `--dangerously-skip-permissions` — required for unattended runs (no interactive prompts)
- `--print` — non-interactive mode, exits when done

### Nightly cron

```bash
# crontab -e
0 2 * * * cd /home/$(whoami)/repos/podlog && claude -p "/codebase-audit" --allowedTools "Read,Glob,Grep,Write,Edit,Bash,Agent" --model opus --worktree --dangerously-skip-permissions --print > /tmp/audit-$(date +\%Y-\%m-\%d).log 2>&1
```

### Output

- **Report:** `docs/audit/YYYY-MM-DD-audit.md` — committed and pushed to main
- **Issues:** CRITICAL and WARNING findings auto-create GitHub issues with label `codebase-audit`
- **Status:** Check the `> Status:` line at the top of the report to see if it completed (`COMPLETE 7/7`) or was interrupted (`IN PROGRESS N/7`)

### What it checks

| Check | What it does |
|-------|-------------|
| Architecture | File structure, orphan files, circular deps, large files |
| Docs freshness | README claims, badge values, guide accuracy, PRD status |
| Test coverage | Runs pytest --cov and jest --coverage, parses results |
| Dead code | Files with no imports, orphaned tests, unused exports |
| Wizard completeness | Spec compliance + feature coverage gaps |
| CLAUDE.md accuracy | Repo structure, tech stack versions, current state |
| Dependency health | Outdated packages, unused deps, missing deps |
```

- [ ] **Step 3: Verify the section was added**

```bash
grep "Codebase Audit" docs/development.md
```

Expected: `## Codebase Audit`

- [ ] **Step 4: Commit**

```bash
git add docs/development.md
git commit -m "docs: add codebase audit invocation instructions to development guide"
```

---

### Task 11: Smoke test the skill

- [ ] **Step 1: Verify the skill is discoverable**

Check that Claude Code can see the skill:

```bash
ls ~/.claude/skills/codebase-audit/SKILL.md
```

Expected: file exists.

- [ ] **Step 2: Verify the SKILL.md structure is valid**

```bash
head -4 ~/.claude/skills/codebase-audit/SKILL.md
```

Expected:
```
---
name: codebase-audit
description: Use when performing a comprehensive repository audit...
---
```

- [ ] **Step 3: Verify all 7 subagent prompts are present and properly formatted**

```bash
grep "^### Subagent" ~/.claude/skills/codebase-audit/SKILL.md
```

Expected output (7 lines):
```
### Subagent 1: Architecture Review
### Subagent 2: Docs Freshness
### Subagent 3: Test Coverage
### Subagent 4: Dead Code Detection
### Subagent 5: Wizard Completeness
### Subagent 6: CLAUDE.md Accuracy
### Subagent 7: Dependency Health
```

- [ ] **Step 4: Verify docs/audit directory exists in repo**

```bash
ls docs/audit/.gitkeep
```

- [ ] **Step 5: Verify docs/development.md has the audit section**

```bash
grep -A2 "## Codebase Audit" docs/development.md
```

- [ ] **Step 6: Run a quick dry-run test**

Invoke the skill interactively to verify it starts correctly. In a Claude Code session:

```
/codebase-audit
```

Verify:
- The skill loads without errors
- It attempts to create the report file
- It attempts to dispatch subagents

If any step fails, fix the SKILL.md content and re-test.

- [ ] **Step 7: Final commit if any fixes were needed**

```bash
git add docs/
git commit -m "fix: address issues found during codebase-audit smoke test"
```

Only run this if fixes were made in step 6.
