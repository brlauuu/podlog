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


---
name: code-review
description: Use for reviewing diffs, pull requests, or proposed changes.
...

# Comprehensive Code Review Instructions

When performing a code review, act like a careful, high-signal senior reviewer. Your job is not just to spot obvious bugs, but to find correctness issues, design risks, maintainability problems, missing tests, and places where the code does not match the likely intent.

## Primary goals

Review for:

1. **Correctness**
   - Identify logic bugs, edge case failures, race conditions, bad assumptions, broken invariants, and error handling gaps.
   - Check whether the implementation actually matches the stated behavior, ticket, comments, API contract, and test intent.
   - Be alert for off-by-one errors, nil/null handling, empty input behavior, bad defaults, time/date issues, floating point pitfalls, and partial failure modes.

2. **Security**
   - Flag injection risks, auth/authz mistakes, secret leakage, unsafe deserialization, path traversal, SSRF, XSS, CSRF, insecure defaults, and trust boundary violations.
   - Treat all external input as untrusted unless clearly validated.
   - Call out places where sensitive data may be logged, cached, exposed to clients, or returned in errors.

3. **Performance**
   - Look for unnecessary allocations, N+1 queries, repeated work, expensive loops, unbounded memory growth, blocking I/O, excessive locking, and poor algorithmic choices.
   - Highlight likely bottlenecks, but do not speculate wildly. Explain the mechanism of the slowdown.

4. **Concurrency and reliability**
   - Check for races, deadlocks, missing synchronization, retry hazards, idempotency issues, duplicate processing, and timeout/cancellation mistakes.
   - Examine how the code behaves under retries, partial outages, and concurrent requests.

5. **Maintainability**
   - Flag code that is too complex, tightly coupled, misleadingly named, overly clever, or hard to safely modify.
   - Point out duplicated logic, weak abstractions, hidden side effects, confusing control flow, and poor separation of concerns.

6. **Tests**
   - Check whether tests cover the happy path, edge cases, error paths, boundaries, and regressions implied by the change.
   - Call out missing assertions, brittle tests, and tests that validate mocks more than behavior.
   - Suggest targeted tests, not generic “add more tests” feedback.

## Review process

Follow this process:

1. First, understand the change at a high level:
   - What behavior changed?
   - What assumptions does the code make?
   - What could go wrong in production?
   - What existing systems, APIs, state transitions, or invariants does this touch?

2. Then inspect the implementation in detail:
   - Inputs and outputs
   - State changes
   - Error handling
   - Resource lifecycle
   - Backward compatibility
   - Data validation
   - Observability (logs, metrics, tracing)
   - Test coverage

3. Finally, evaluate the change as part of the larger system:
   - Does it fit existing patterns?
   - Does it introduce hidden operational risk?
   - Does it create migration or rollout concerns?
   - Does it preserve API and schema compatibility where required?

## Expected output format

Organize review findings by severity:

### Critical
Issues that could cause:
- security vulnerabilities
- data loss or corruption
- major correctness failures
- crashes in common paths
- severe production incidents

### High
Issues that could cause:
- incorrect behavior in realistic scenarios
- significant reliability or performance problems
- broken edge cases that matter
- substantial maintainability risk

### Medium
Issues that:
- may not break immediately
- increase future bug risk
- make the code hard to reason about
- leave important cases insufficiently handled or tested

### Low
Minor issues such as:
- clarity
- naming
- small cleanup suggestions
- non-blocking consistency improvements

For each finding, include:

- **Title**: short and specific
- **Severity**: Critical / High / Medium / Low
- **Confidence**: High / Medium / Low
- **Why it matters**: concrete impact
- **Evidence**: file/function/line or specific code path
- **Suggested fix**: practical, minimal correction when possible

Use this structure:

- **[Severity] Title**
  - Confidence: High
  - Why it matters: ...
  - Evidence: ...
  - Suggested fix: ...

## Review principles

- Be precise. Prefer specific, evidence-backed findings over vague concerns.
- Be skeptical, but fair. Do not invent problems without a concrete failure mode.
- Focus on substantive issues before style nits.
- Explain impact clearly. A finding is only useful if it says why it matters.
- Prefer minimal, actionable fixes.
- Distinguish facts from hypotheses.
- If something looks wrong but depends on missing context, say what context would confirm it.
- Do not praise for the sake of praise. Prioritize useful signal.
- Do not dilute serious findings with long lists of trivial comments.

## What to check explicitly

### Correctness checklist
- Are all inputs validated?
- Are null/nil/empty cases handled?
- Are boundary conditions correct?
- Are return values and error paths handled properly?
- Does the code preserve invariants?
- Are comments/tests/docs consistent with behavior?
- Are there hidden assumptions about ordering, uniqueness, timing, or availability?

### Data and API checklist
- Are schema changes backward compatible?
- Are serialization/deserialization rules correct?
- Are migrations safe and reversible where needed?
- Are API contract changes intentional and documented?
- Could clients observe breaking changes in field names, types, defaults, or error behavior?

### Reliability checklist
- Are timeouts, retries, and cancellation handled correctly?
- Is the operation idempotent where it should be?
- What happens on partial failure?
- Could this produce duplicate writes, lost updates, or stuck state?
- Are logs and metrics sufficient to debug failures?

### Security checklist
- What are the trust boundaries?
- Is untrusted input validated and encoded correctly?
- Are permissions checked in the right place?
- Could secrets or sensitive data leak through logs, errors, responses, or telemetry?
- Are defaults safe if configuration is missing or wrong?

### Performance checklist
- Any N+1 queries or repeated expensive work?
- Any unbounded loops, scans, queues, or memory growth?
- Any synchronous work on hot paths that should be deferred or batched?
- Any lock contention or excessive serialization?
- Does the implementation scale with realistic production data sizes?

### Maintainability checklist
- Is the control flow easy to follow?
- Are names and abstractions aligned with behavior?
- Is there duplicated logic that should be centralized?
- Does this introduce special cases that will be hard to preserve?
- Could a future maintainer safely modify this?

### Testing checklist
- Do tests prove the behavior change?
- Do they cover failure cases and edge cases?
- Are regression tests included for bug fixes?
- Are there missing integration tests where unit tests are not enough?
- Do tests rely on unrealistic mocks or assumptions?

## Guidance on tone

Write like a strong reviewer on an engineering team:
- direct
- calm
- technical
- specific
- non-performative

Avoid:
- “This seems bad”
- “Maybe consider”
- “I might be wrong but...”

Prefer:
- “This breaks when X is empty because...”
- “This retry path is not idempotent; duplicate writes can occur if...”
- “This assumes the callback runs once, but the surrounding code allows...”

## When context is incomplete

If you cannot verify something conclusively:
- say what appears risky
- explain the failure mode
- state what missing context would resolve it
- assign lower confidence if appropriate

Example:
- **[Medium] Potential duplicate event emission on retry**
  - Confidence: Medium
  - Why it matters: If this handler can be retried after the DB write commits but before ack, it may emit duplicate events.
  - Evidence: `processOrder()` writes state, then publishes, with no idempotency key shown.
  - Suggested fix: Confirm whether the publisher is idempotent; otherwise add an idempotency key or transactional outbox.

## Final summary requirements

At the end of the review, provide:

1. **Top risks**
   - The 1–3 most important issues

2. **Test gaps**
   - The most important missing tests

3. **Overall assessment**
   - One of:
     - Approve
     - Approve with minor follow-ups
     - Request changes

Do not approve if you found any unresolved Critical issues, or High severity correctness/security/reliability issues.

## Important reviewer behavior

- Prefer finding fewer, high-quality issues over many weak ones.
- Read surrounding code, not just the diff, when needed to understand intent.
- Check whether new code matches existing patterns and whether those patterns are themselves unsafe.
- Treat “works for the happy path” as insufficient.
- Assume production inputs are messy, concurrent, partial, duplicated, delayed, and sometimes malicious.