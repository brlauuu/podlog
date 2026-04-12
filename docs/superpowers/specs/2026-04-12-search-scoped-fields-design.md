# Scoped Search Across Transcripts, Metadata, and Speakers - Design Spec

**Date:** 2026-04-12  
**Issue:** #357  
**Status:** Approved

## Overview

Expand search so users can find matches in:
- transcript text (existing)
- episode titles
- episode descriptions
- speaker names

Add scoped syntax in the query input:
- `title:<text>`
- `description:<text>`
- `speaker:<text>`

All scoped searches must be case-insensitive, and speaker scoped values must support partial matching (for example `speaker: jacob` matches `Jacob Shapiro`).

## Goals

1. Keep current transcript hybrid search behavior as the default path.
2. Add scoped filters without breaking existing query patterns.
3. Ensure scoped-only queries do not use transcript content.
4. Support mixed queries such as `crisis in Iran speaker: Jacob Shapiro` where transcript matching is constrained by speaker.
5. Add pagination controls for 20 / 50 / 100 results per page.

## Non-Goals

1. No fuzzy ranking model changes beyond existing hybrid behavior.
2. No schema migration requirement for the first implementation pass.
3. No new global search endpoint; extend existing `/api/search` and `/api/search/grouped`.

## Query Syntax and Semantics

## Tokens

- Free-text terms: anything not captured by a scoped token.
- Scoped tokens:
  - `title:<value>`
  - `description:<value>`
  - `speaker:<value>`

Values are parsed as:
- quoted (`title:"What the Heck is Happening in China"`)
- or unquoted (`speaker: jacob`)

## Case and matching rules

1. `title:` and `description:` matching is case-insensitive.
2. `speaker:` matching is case-insensitive and partial (`ILIKE '%value%'` behavior).
3. Existing free-text transcript matching remains case-insensitive through FTS.

## Execution modes

1. **Transcript hybrid mode**  
   Trigger: free-text exists (with or without scoped tokens).  
   Behavior:
   - transcript FTS + vector merge remains active
   - scoped filters constrain candidate rows
   - example: `crisis in Iran speaker: Jacob Shapiro` searches transcript for "crisis in Iran" but only for matching speaker turns.

2. **Metadata-only mode**  
   Trigger: no free-text, only scoped tokens present.  
   Behavior:
   - do not query transcript turns or segment embeddings
   - query episode title / description and speaker name metadata only
   - return results compatible with existing UI contract.

## API Contract Updates

Existing routes remain:
- `GET /api/search`
- `GET /api/search/grouped`

Changes:
1. `q` remains required and carries full user query (including scoped syntax).
2. page size max changes from 50 to 100.
3. server parses query into structured filters before executing search path.
4. response shape remains backward-compatible for existing UI components.

## UI Changes

Search page updates:
1. Add page size selector with values `20`, `50`, `100`.
2. Apply page size in both flat and grouped view fetches.
3. Add grouped-view pagination controls (same prev/next semantics).
4. Update search help text to document scoped syntax and case-insensitive behavior.

## Data and SQL Strategy

## Transcript hybrid mode

- Keep existing speaker-turn CTE and vector merge.
- Apply parsed filters:
  - `speaker:` as speaker display/label constraint
  - `title:` and `description:` as episode-level constraints in joined `episodes`.

## Metadata-only mode

- Query `episodes` (+ `speaker_names` where needed) with feed filters and status constraints.
- Build snippets from matched metadata field(s) for consistent card rendering.
- Use deterministic ordering:
  - highest metadata relevance first (where available)
  - fallback by recency (`COALESCE(published_at, created_at)` desc).

## Error Handling and Validation

1. Empty `q` remains `400`.
2. Malformed scoped token falls back to plain free-text rather than hard failure.
3. If a scoped token has empty value (for example `title:`), treat as non-operative filter and continue.

## Testing Strategy

1. Unit: query parser
   - quoted/unquoted tokens
   - mixed scoped + free-text
   - case normalization behavior
2. Unit: API routes
   - page size 100 accepted
   - parsed query forwarded correctly
3. Unit: search library
   - metadata-only path selection
   - mixed query with `speaker:` constraint in transcript mode
4. UI tests
   - page-size selector requests proper page size
   - grouped pagination controls visible and functional
   - help text includes scoped syntax examples

## Acceptance Criteria

1. `title:` scoped query matches titles case-insensitively and excludes transcript matches when scoped-only.
2. `description:` scoped query matches descriptions case-insensitively and excludes transcript matches when scoped-only.
3. `speaker:` scoped query matches speaker names case-insensitively with partial matching.
4. Mixed query (`free text + speaker:`) constrains transcript results by speaker.
5. Page size options `20`, `50`, `100` are available and functional.
6. Grouped and flat views both support pagination with selected page size.
7. Existing unscoped transcript search behavior remains intact.
