# Scoped Search Across Transcripts, Metadata, and Speakers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement case-insensitive scoped search (`title:`, `description:`, `speaker:`), preserve transcript hybrid behavior, and add 20/50/100 pagination controls.

**Architecture:** Add a shared query parser that splits free-text and scoped filters, route search execution into transcript-hybrid or metadata-only paths in `search.ts`, then propagate page-size and pagination UI updates through search page state and APIs.

**Tech Stack:** Next.js App Router, React, TanStack Query, PostgreSQL (FTS + pgvector), Jest, Playwright.

---

### Task 1: Add Scoped Query Parser

**Files:**
- Create: `apps/web/src/lib/search/queryParser.ts`
- Test: `apps/web/tests/unit/search-query-parser.test.ts`

- [ ] **Step 1: Create parser types and public API**

Implement `queryParser.ts` with exported types/functions:
- `ParsedSearchQuery`
- `parseSearchQuery(raw: string): ParsedSearchQuery`
- `buildNormalizedQuery(parsed: ParsedSearchQuery): string`

Include fields:
- `raw`
- `freeText`
- `titleFilter`
- `descriptionFilter`
- `speakerFilter`
- `mode: "transcript_hybrid" | "metadata_only"`

- [ ] **Step 2: Implement scoped token extraction**

Rules:
- recognize `title:`, `description:`, `speaker:` case-insensitively
- support quoted and unquoted values
- allow multiple same-scope tokens by concatenating with spaces
- remaining text becomes `freeText`

- [ ] **Step 3: Implement mode selection**

Rules:
- `metadata_only` when `freeText` is empty and at least one scoped filter is present
- otherwise `transcript_hybrid`

- [ ] **Step 4: Add parser unit tests**

Cover:
- plain free text
- `title:` only
- `description:` only
- `speaker:` only (partial value)
- quoted values with spaces
- mixed query (`crisis in Iran speaker: Jacob Shapiro`)
- uppercase scopes (`TITLE:`, `SPEAKER:`)
- empty scoped value fallback behavior

- [ ] **Step 5: Run parser unit tests**

Run: `cd apps/web && npm test -- --runTestsByPath tests/unit/search-query-parser.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit parser changes**

```bash
git add apps/web/src/lib/search/queryParser.ts apps/web/tests/unit/search-query-parser.test.ts
git commit -m "feat: add scoped search query parser (#357)"
```

---

### Task 2: Extend Flat Search API for Parsed Query + Page Size 100

**Files:**
- Modify: `apps/web/src/app/api/search/route.ts`
- Modify: `apps/web/tests/unit/flat-search.test.ts`

- [ ] **Step 1: Parse `q` into structured query in route**

Import parser and transform raw query before calling search lib.

- [ ] **Step 2: Raise `pageSize` max clamp to 100**

Change clamp from `Math.min(50, ...)` to `Math.min(100, ...)`.

- [ ] **Step 3: Update `searchSegments` call signature usage**

Pass parsed query object (or equivalent structured args) while preserving existing route behavior for feed/upload/speaker params until search lib migration completes.

- [ ] **Step 4: Update route tests**

Add/modify tests to assert:
- clamp to 100
- parser-integrated invocation behavior
- compatibility for plain unscoped query

- [ ] **Step 5: Run flat route tests**

Run: `cd apps/web && npm test -- --runTestsByPath tests/unit/flat-search.test.ts`  
Expected: PASS

- [ ] **Step 6: Commit flat API updates**

```bash
git add apps/web/src/app/api/search/route.ts apps/web/tests/unit/flat-search.test.ts
git commit -m "feat: extend flat search route for scoped parsing and page size 100 (#357)"
```

---

### Task 3: Extend Grouped Search API for Parsed Query + Page Size 100

**Files:**
- Modify: `apps/web/src/app/api/search/grouped/route.ts`
- Modify: `apps/web/tests/unit/grouped-search.test.ts`

- [ ] **Step 1: Parse `q` using shared parser**

Apply same parser strategy as flat route.

- [ ] **Step 2: Raise grouped route max page size to 100**

Change clamp from 50 to 100.

- [ ] **Step 3: Update grouped route tests**

Assert:
- 100 clamp
- parser-integrated call args
- compatibility for plain queries

- [ ] **Step 4: Run grouped route tests**

Run: `cd apps/web && npm test -- --runTestsByPath tests/unit/grouped-search.test.ts`  
Expected: PASS

- [ ] **Step 5: Commit grouped API updates**

```bash
git add apps/web/src/app/api/search/grouped/route.ts apps/web/tests/unit/grouped-search.test.ts
git commit -m "feat: extend grouped search route for scoped parsing and page size 100 (#357)"
```

---

### Task 4: Add Metadata-Only Search Path in Search Library

**Files:**
- Modify: `apps/web/src/lib/search.ts`
- Modify: `apps/web/src/lib/search/types.ts`
- Test: `apps/web/tests/unit/search-lib.test.ts`

- [ ] **Step 1: Add search function signatures for parsed query**

Update `searchSegments` and `searchGrouped` signatures to receive parsed query object (or derived args) including:
- `freeText`
- `titleFilter`
- `descriptionFilter`
- `speakerFilter`
- `mode`

- [ ] **Step 2: Implement metadata-only branch in `searchSegments`**

When `mode === "metadata_only"`:
- query episodes (+ speaker metadata when needed)
- filter by scoped fields only
- bypass transcript FTS and vector merge
- keep feed/status filters
- return `SearchPage` contract with deterministic ordering

- [ ] **Step 3: Implement metadata-only branch in `searchGrouped`**

When scoped-only:
- grouped counts and rows based on episode metadata matches
- do not count transcript mentions

- [ ] **Step 4: Keep transcript hybrid branch for default and mixed queries**

For `transcript_hybrid`:
- retain current FTS + vector flow
- apply `speakerFilter` as case-insensitive partial match against speaker display/label
- apply `titleFilter` / `descriptionFilter` as episode-level narrowing conditions

- [ ] **Step 5: Extend type definitions if needed for result provenance**

If UI needs to distinguish metadata match source, add optional field(s) in `SearchResult` with backward compatibility.

- [ ] **Step 6: Update search library tests**

Add tests for:
- metadata-only mode path chosen
- transcript mode preserved for unscoped query
- mixed query with speaker scoped filter constraining transcript results

- [ ] **Step 7: Run search lib tests**

Run: `cd apps/web && npm test -- --runTestsByPath tests/unit/search-lib.test.ts`  
Expected: PASS

- [ ] **Step 8: Commit search library changes**

```bash
git add apps/web/src/lib/search.ts apps/web/src/lib/search/types.ts apps/web/tests/unit/search-lib.test.ts
git commit -m "feat: add metadata-only and scoped-filter search execution paths (#357)"
```

---

### Task 5: Update Search UI for Page Size + Grouped Pagination + Help Text

**Files:**
- Modify: `apps/web/src/app/search/page.tsx`
- Potentially modify: `apps/web/src/components/SearchResult.tsx` (only if metadata-only result display needs small adjustments)
- Update tests:
  - `apps/web/tests/unit/search-spinner.test.tsx`
  - `apps/web/tests/unit/search-url-priority.test.tsx`
  - `apps/web/tests/e2e/search.spec.ts`

- [ ] **Step 1: Add `pageSize` state with default 20**

Update query keys and API params for both flat/grouped requests to include dynamic page size.

- [ ] **Step 2: Add page-size selector UI**

Provide selectable options: `20`, `50`, `100`.  
Reset `page` to `1` when page size changes.

- [ ] **Step 3: Add grouped-view pagination controls**

Use grouped totals and current page/pageSize to calculate page count and render prev/next controls analogous to flat mode.

- [ ] **Step 4: Update help text with scoped syntax**

Include examples:
- `title:...`
- `description:...`
- `speaker:...`
- note all scoped searches are case-insensitive.

- [ ] **Step 5: Update unit/e2e tests for UI behavior**

Cover:
- page-size param usage in requests
- grouped pagination visibility and navigation
- updated help text rendering

- [ ] **Step 6: Run focused UI tests**

Run:
- `cd apps/web && npm test -- --runTestsByPath tests/unit/search-spinner.test.tsx tests/unit/search-url-priority.test.tsx`
- `cd apps/web && npm test -- --runTestsByPath tests/e2e/search.spec.ts` (or project-standard e2e command if required)

Expected: PASS

- [ ] **Step 7: Commit UI changes**

```bash
git add apps/web/src/app/search/page.tsx apps/web/src/components/SearchResult.tsx apps/web/tests/unit/search-spinner.test.tsx apps/web/tests/unit/search-url-priority.test.tsx apps/web/tests/e2e/search.spec.ts
git commit -m "feat: add scoped-search UX hints and 20/50/100 pagination controls (#357)"
```

---

### Task 6: Regression Verification and Documentation

**Files:**
- Modify (if needed): `docs/guide/*` search-related docs
- Modify: `docs/superpowers/specs/2026-04-12-search-scoped-fields-design.md` (if behavior changed during implementation)

- [ ] **Step 1: Run full web test suite subset for search**

Run:
- `cd apps/web && npm run test -- --runTestsByPath tests/unit/flat-search.test.ts tests/unit/grouped-search.test.ts tests/unit/search-lib.test.ts tests/unit/search-query-parser.test.ts`

Expected: PASS

- [ ] **Step 2: Run lint and typecheck**

Run:
- `cd apps/web && npm run typecheck`
- `cd apps/web && npm run lint`

Expected: No new errors

- [ ] **Step 3: Update docs if required**

If any final behavior differs from spec wording, update the spec and any user guide search syntax references.

- [ ] **Step 4: Final commit for verification/docs**

```bash
git add docs/superpowers/specs/2026-04-12-search-scoped-fields-design.md docs/guide
git commit -m "docs: align search docs with scoped search behavior (#357)"
```

---

## Spec Coverage Check

- Scoped syntax (`title:`, `description:`, `speaker:`): Tasks 1, 4, 5
- Case-insensitive special searches and partial speaker match: Tasks 1, 4
- Metadata-only behavior excluding transcript matches: Task 4
- Mixed free-text + scoped constraints: Task 4
- Pagination defaults and 20/50/100 options: Tasks 2, 3, 5
- Grouped + flat pagination UX: Task 5
- Regression safety: Task 6

## Placeholder Scan

- No TBD/TODO placeholders
- All tasks include explicit files and commands
- Scope is constrained to issue #357 behavior without unrelated refactors
