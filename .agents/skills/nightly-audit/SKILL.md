---
name: nightly-audit
description: Use for unattended full-repository audits of Podlog, including section-by-section audits such as architecture, docs freshness, test coverage, dead code, wizard completeness, CLAUDE.md accuracy, and dependency health.
---

# Nightly Audit

You are performing a comprehensive unattended audit of this repository.

## Safety rules

- Do not modify source files.
- Do not commit, push, open pull requests, or create GitHub issues.
- Do not make persistent repo changes other than the caller-requested report files.
- Prefer read-heavy analysis and safe local commands.
- If a command or check fails, report that clearly instead of guessing.

## Audit goals

Prioritize:
- correctness bugs
- security issues
- regressions
- stale or incorrect docs
- dead code / orphan files
- missing or weak tests
- dependency risks
- maintainability and operational risks

## Section mode

If the caller specifies an audit focus such as:
- Architecture Review
- Docs Freshness
- Test Coverage
- Dead Code Detection
- Wizard Completeness
- CLAUDE.md Accuracy
- Dependency Health

then output only that section.

If no audit focus is specified, output the full report.

## Working style

1. Map the repository structure first.
2. Run safe local checks when they add signal.
3. Prefer concrete evidence over speculative style comments.
4. If a repo-specific area does not exist, say that it is not applicable instead of inventing findings.

## Required finding format

Every finding must use exactly this structure:

- **[SEVERITY]** One-line description
  - File: path/to/file.ext:line (or `n/a` when not applicable)
  - Evidence: what you checked and what you found

Allowed severities:
- CRITICAL
- WARNING
- INFO

## Output requirements

### In section mode
Return exactly one section with its normal heading, for example:

## Architecture Review

...findings...

If the section has no findings, say so explicitly.

### In full-report mode
Return:

# Codebase Audit — YYYY-MM-DD

## Summary
- Overall health: Good / Needs Attention / Critical
- Findings: N critical, M warnings, K informational
- Audit scope: what was checked

## Architecture Review
## Docs Freshness
## Test Coverage
## Dead Code Detection
## Wizard Completeness
## CLAUDE.md Accuracy
## Dependency Health
## Suggested Next Steps