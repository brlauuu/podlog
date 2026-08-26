# Docs Ask bubble — Design

**Status:** Draft
**Date:** 2026-08-26
**Issue:** [#990](https://github.com/brlauuu/podlog/issues/990)
**Owner:** @brlauuu

## Summary

An Ask bubble on `/docs` that answers questions about Podlog itself — how to operate it and why it works the way it does — rather than about podcast transcripts. Retrieval selects the handful of documentation sections most relevant to the question and passes only those to the model; generation reuses the existing pipeline Ask path unchanged. No embeddings, no index to maintain, no migration.

## Goals

1. Answer "how do I…" and "why does it work this way" from the shipped documentation and the PRDs.
2. Work identically on a local-only install and on Fireworks. Podlog's default is local-only; a feature that silently answers worse there is worse than one that says it needs remote inference.
3. Never answer from documentation that no longer exists. The corpus is read from the filesystem at request time.
4. Cite the exact heading an answer came from, deep-linked where a rendered page exists.
5. Add no maintenance burden to docs PRs.

## Non-goals

- Embeddings, a `docs_chunks` table, or any re-index step.
- Changing the transcript Ask path (`/ask`) in any way.
- A corpus switch or mode the user has to manage.
- Answering from the codebase itself. This is a documentation assistant.
- Multi-user concerns. Podlog is single-user self-hosted.

## Decisions

Four decisions were settled before this spec, each with the alternative recorded so a later reader can see what was traded away.

### D1 — Corpus: guide + reference docs + PRDs

The bubble answers both "how" and "why", so the corpus is `docs/guide/` (20 files), `docs/*.md` (5 files) and `prds/` (7 files).

**Measured, not estimated:**

| corpus | files | words | ≈ tokens | sections |
|---|---|---|---|---|
| `docs/guide/` | 20 | 15,648 | ~21k | 147 |
| `docs/*.md` | 5 | 7,796 | ~10k | — |
| `prds/` | 7 | 23,277 | ~31k | 234 |
| **total** | **32** | **46,721** | **~62k** | **381+** |

Note for anyone reconciling with #990: that issue quoted ~99k tokens for `docs/`, which counted `docs/audit/` and `docs/superpowers/` — agent artifacts, not user documentation. The user-facing figure is materially smaller, though still far past any local context window.

**Trade-off accepted:** PRDs contain rejected options, risk registers and internal design argument. Surfacing those in a user-facing bubble is a real change in what the UI can say. On a single-user self-hosted install the operator is the author, so this is judged acceptable; it would not be on a multi-tenant product.

### D2 — Retrieval: sections, uniformly, on both providers

The corpus cannot fit any local model:

```python
MODEL_NUM_CTX = {"qwen2.5:3b": 8192, "phi3:mini": 16384, "gemma3n:e4b": 16384}
```

~62k against an 8k floor rules out putting the whole corpus in context. Even `docs/guide/` alone (~21k) overflows every entry.

So retrieval selects the top **6–8 sections** by keyword score. Guide sections average **106 words**, putting a typical payload at **1–3k tokens** — comfortable inside 8k alongside the system prompt and conversation history.

**Rejected — maintained embeddings:** buys little on a corpus this small and introduces a staleness failure that is *silent*: after a docs PR, an un-re-embedded index answers confidently from deleted documentation. Silence is the worst property a documentation assistant can have.

**Rejected — whole corpus on Fireworks, retrieval locally:** two code paths and two answer qualities for the same question, plus ~62k tokens per question on the remote path.

### D3 — Topology: web retrieves, pipeline generates

`docker-compose.yml` mounts the documentation into `web` only:

```yaml
  web:
    volumes:
      - ./docs/guide:/docs/guide:ro
      - ./docs/about.md:/docs/about.md:ro
      - ./CHANGELOG.md:/docs/CHANGELOG.md:ro
```

The pipeline container **cannot read the documentation at all**, and `prds/` is mounted nowhere. Meanwhile provider routing, context sizing, prompt construction and SSE streaming all live in `apps/pipeline/app/services/rag.py`.

So the web app retrieves — it already has the files and the splitter — and hands the selected sections to the pipeline, which generates.

**Rejected — web does everything:** would duplicate provider routing, `MODEL_NUM_CTX`, prompt building and SSE streaming in TypeScript. Two copies of provider logic is exactly the drift this codebase has been bitten by.

**Rejected — mount docs into the pipeline and port the splitter to Python:** `CLAUDE.md` records the cross-runtime rule directly — duplicated helpers across TS and Python must be kept in lockstep, and silent divergence corrupts shared behaviour. The web app would still need its own copy for the existing docs search UI, so this creates the duplication rather than avoiding it.

### D4 — Surface: `/docs` only

A bubble on the docs pages, mirroring `EpisodeChat`'s existing pattern. `/ask` is untouched and remains transcripts-only.

**Rejected — one surface with a corpus switch:** an answer drawn from the wrong corpus reads as a bad answer rather than a wrong setting, and it puts a mode on the user that the placement makes unnecessary.

## Architecture

```
/docs page
  └── DocsAskBubble (new, mirrors EpisodeChat)
        │  question + history
        ▼
  /api/docs/ask  (new Next route)
        │  1. build/reuse the section index from the mounted files
        │  2. score sections against the question (docs-search.ts)
        │  3. take top 6–8
        ▼
  POST pipeline /api/ask   { question, history, context: [...] }
        │  4. context present  ->  skip retrieve_chunks
        │  5. build prompt from supplied sections
        │  6. existing provider routing + SSE stream
        ▼
  SSE proxied back to the bubble, with citations
```

### Components

**`buildDocsCorpusIndex()`** — extends the existing `docs-index.ts`. Today it reads `docs/guide/` and splits on `##` / `###` with `makeUniqueSlugger` for anchors. It gains `docs/*.md` and `prds/` as sources and a `source` discriminator (`guide` | `reference` | `prd`) per section. Memoised at module level exactly as today; a `_reset` hook already exists for tests.

**Section scoring** — reuses `docs-search.ts`'s existing keyword scorer and snippet extraction, which already power the docs search UI. Selection takes the top N by score with a token budget cap, so a few very long PRD sections cannot crowd out the rest.

**`/api/docs/ask`** — a new Next route. Retrieves, then proxies to the pipeline and streams the SSE response back. It does not talk to any model provider itself.

**`AskRequest.context`** — a new optional field on the pipeline's request model:

```python
class DocSection(BaseModel):
    title: str
    source: str      # guide | reference | prd
    slug: str        # docs page slug, or repo path for PRDs
    anchor: str | None
    text: str

class AskRequest(BaseModel):
    ...
    context: list[DocSection] | None = None
```

When `context` is present, `ask.py` skips `retrieve_chunks` and builds the prompt from the supplied sections. Provider routing, `MODEL_NUM_CTX` handling, streaming and error paths are untouched.

### Citations

Guide sections already carry stable anchor IDs from `makeUniqueSlugger`, shared between the renderer and the search indexer. A guide citation deep-links to the exact heading:

```
/docs?page=08-queue#error-classification
```

PRDs have no rendered surface, so those cite to the repository, reusing the `REPO_BLOB_BASE_URL` convention `resolveMarkdownHref` already applies to non-guide markdown links:

```
https://github.com/brlauuu/podlog/blob/main/prds/PRD-01-ingestion-pipeline.md
```

The difference is deliberate and visible: a reader can tell a user-guide answer from a design-document answer by where the citation points.

## Consequences worth stating plainly

**The pipeline's Ask API becomes general-purpose.** With `context` supplied, `/api/ask` answers over arbitrary caller-provided text. Given the API already has no authentication and is reachable through the unauthenticated web proxy from the LAN (#988), this creates no new trust boundary — but it does change what the endpoint *is*. It should be documented as such rather than discovered later.

**`prds/` needs a new read-only mount** into `web`. That is the only infrastructure change.

**Answer quality is bounded by keyword retrieval.** A question phrased in words the documentation does not use will retrieve poorly. This is the accepted cost of having nothing to maintain; if it proves limiting, embeddings can be added behind the same retrieval seam without touching the rest.

## Testing strategy

- **Index:** PRDs and reference docs are indexed; `source` is assigned correctly; anchors match what the renderer produces for the same heading.
- **Selection:** returns at most N sections; respects the token budget; a long PRD section cannot crowd out the guide; an empty corpus returns nothing rather than throwing.
- **Route:** proxies to the pipeline with the retrieved sections; streams SSE back; a pipeline failure surfaces as an error rather than a hung stream.
- **Pipeline:** `context` present skips `retrieve_chunks`; absent behaves exactly as today (guarding the transcript path against regression); the supplied sections appear in the built prompt.
- **Citations:** a guide citation resolves to a real page slug and anchor; a PRD citation resolves to the repo path.
- **Cross-runtime:** the anchor algorithm stays shared between renderer and indexer — the existing `docs-slug.ts` is already the single source, and this must not fork.

## Risks

| Risk | Mitigation |
|---|---|
| PRD content surfaces in an answer that reads as user-facing guidance | `source` is carried through and shown in the citation, so design-document answers are labelled |
| Keyword retrieval misses a well-formed question | Accepted; the retrieval seam allows embeddings later without restructuring |
| `context` field misused as a general LLM proxy | Documented as a deliberate capability; no new exposure beyond what #988 already describes |
| Long PRD sections dominate the payload | Token budget cap in selection, tested |

## Open questions

None. The four decisions above were settled before this spec was written.
