# Docs Ask Bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an Ask bubble to `/docs` that answers questions about Podlog itself from the guide, reference docs and PRDs, citing the exact heading each answer came from.

**Architecture:** The web app owns retrieval — it is the only container with the documentation mounted, and it already splits `docs/guide/` into heading-delimited sections. It scores sections against the question, takes the top few, and posts them to the pipeline's existing Ask endpoint as supplied context. The pipeline skips its own transcript retrieval when context is supplied and reuses its provider routing, prompt building and SSE streaming unchanged.

**Tech Stack:** Next.js 16 App Router (TypeScript, Jest), FastAPI + Pydantic (Python, pytest), Docker Compose bind mounts.

**Spec:** `docs/superpowers/specs/2026-08-26-docs-ask-design.md`

## Global Constraints

- **Corpus:** `docs/guide/*.md`, `docs/*.md`, `prds/*.md`. Nothing else. Never index `docs/audit/` or `docs/superpowers/` — they are agent artifacts, not documentation.
- **Token budget:** selected sections must total **≤ 4000 tokens** (estimated at 4 characters per token). The smallest supported local model is `qwen2.5:3b` at 8192 context, shared with the system prompt and history.
- **Section cap:** at most **8** sections per question.
- **No embeddings, no database tables, no migrations.** The index is rebuilt from the filesystem.
- **Do not modify the transcript Ask path.** `/ask`, `retrieve_chunks`, and the existing behaviour of `POST /api/ask` without `context` must be unchanged. Task 3 has a regression test for this.
- **Anchor IDs must keep coming from `apps/web/src/lib/docs-slug.ts`.** The renderer and the indexer share it; forking it silently breaks every citation deep-link.
- **Per-change obligations apply** (`CLAUDE.md`): each task's commit adds its CHANGELOG line where user-visible, and Task 5 updates the user guide.

---

### Task 1: Index the reference docs and PRDs

Extends the existing section index from `docs/guide/` only to the full corpus, tagging each section with its source so citations can be routed correctly later.

**Files:**
- Modify: `apps/web/src/lib/docs-search.ts` (add `source` to `DocSection`)
- Modify: `apps/web/src/lib/docs-index.ts` (add corpus builder)
- Modify: `docker-compose.yml` (mount `docs/` and `prds/` into `web`)
- Test: `apps/web/tests/unit/docs-corpus-index.test.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `type DocSource = "guide" | "reference" | "prd"`
  - `DocSection.source: DocSource` — new required field on the existing interface
  - `DocSection.repoPath: string` — e.g. `docs/guide/08-queue.md`, `prds/PRD-01-ingestion-pipeline.md`
  - `buildDocsCorpusIndex(): Promise<DocSection[]>` in `docs-index.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/unit/docs-corpus-index.test.ts
import { buildDocsCorpusIndex, _resetDocsIndexCache } from "@/lib/docs-index";

beforeEach(() => _resetDocsIndexCache());

describe("buildDocsCorpusIndex (#990)", () => {
  it("indexes the guide, the reference docs and the PRDs", async () => {
    const index = await buildDocsCorpusIndex();
    const sources = new Set(index.map((s) => s.source));
    expect(sources).toEqual(new Set(["guide", "reference", "prd"]));
  });

  it("tags each section with the file it came from", async () => {
    const index = await buildDocsCorpusIndex();
    const queue = index.find((s) => s.repoPath === "docs/guide/08-queue.md");
    expect(queue).toBeDefined();
    expect(queue!.source).toBe("guide");

    const prd = index.find((s) => s.repoPath.startsWith("prds/"));
    expect(prd!.source).toBe("prd");
  });

  it("never indexes agent artifacts", async () => {
    // docs/audit/ and docs/superpowers/ are working files, not documentation.
    const index = await buildDocsCorpusIndex();
    const leaked = index.filter(
      (s) => s.repoPath.startsWith("docs/audit/") ||
             s.repoPath.startsWith("docs/superpowers/"),
    );
    expect(leaked).toEqual([]);
  });

  it("keeps guide anchors identical to the ones the renderer emits", async () => {
    // Citations deep-link to these. If the indexer and DocsClient ever use
    // different slug algorithms, every guide citation 404s silently.
    const index = await buildDocsCorpusIndex();
    const guide = index.filter((s) => s.source === "guide" && s.sectionTitle);
    expect(guide.length).toBeGreaterThan(50);
    for (const s of guide.slice(0, 20)) {
      expect(s.sectionId).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("finds a substantial corpus (guards a vacuous pass)", async () => {
    const index = await buildDocsCorpusIndex();
    expect(index.length).toBeGreaterThan(300);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/docs-corpus-index.test.ts`
Expected: FAIL — `buildDocsCorpusIndex is not a function`

- [ ] **Step 3: Add the source discriminator to the section type**

```typescript
// apps/web/src/lib/docs-search.ts — add above `export interface DocSection`
export type DocSource = "guide" | "reference" | "prd";
```

Then add these two fields to the existing `DocSection` interface:

```typescript
  /** Which corpus this section came from (#990). */
  source: DocSource;
  /** Repo-relative file path, e.g. "docs/guide/08-queue.md". */
  repoPath: string;
```

- [ ] **Step 4: Thread the new fields through the existing splitter**

In `apps/web/src/lib/docs-index.ts`, `splitDocIntoSections` currently takes `(docSlug, docTitle, markdown)`. Add two parameters and set the fields on both the preamble section and each heading section:

```typescript
function splitDocIntoSections(
  docSlug: string,
  docTitle: string,
  markdown: string,
  source: DocSource,
  repoPath: string,
): DocSection[] {
```

Inside, every object literal that builds a `DocSection` gains `source, repoPath`. There are two: the initial `current` and the one created on each heading match.

- [ ] **Step 5: Add the corpus builder**

```typescript
// apps/web/src/lib/docs-index.ts
const REPO_ROOT = join(process.cwd(), "..", "..");

interface CorpusEntry {
  dir: string;          // absolute
  repoDir: string;      // repo-relative
  source: DocSource;
}

const CORPUS: CorpusEntry[] = [
  { dir: join(REPO_ROOT, "docs", "guide"), repoDir: "docs/guide", source: "guide" },
  { dir: join(REPO_ROOT, "docs"), repoDir: "docs", source: "reference" },
  { dir: join(REPO_ROOT, "prds"), repoDir: "prds", source: "prd" },
];

let cachedCorpus: DocSection[] | null = null;

/**
 * Full documentation corpus for the docs Ask bubble (#990).
 *
 * Non-recursive per directory on purpose: `docs/` must pick up
 * docs/configuration.md but never docs/audit/ or docs/superpowers/, which
 * are agent working files rather than documentation.
 */
export async function buildDocsCorpusIndex(): Promise<DocSection[]> {
  if (cachedCorpus) return cachedCorpus;

  const out: DocSection[] = [];
  for (const entry of CORPUS) {
    let files: string[] = [];
    try {
      files = (await readdir(entry.dir, { withFileTypes: true }))
        .filter((d) => d.isFile() && d.name.endsWith(".md"))
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }
    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      let raw = "";
      try {
        raw = await readFile(join(entry.dir, file), "utf-8");
      } catch {
        continue;
      }
      out.push(
        ...splitDocIntoSections(
          slug,
          filenameToTitle(slug),
          raw,
          entry.source,
          `${entry.repoDir}/${file}`,
        ),
      );
    }
  }

  cachedCorpus = out;
  return cachedCorpus;
}
```

Also extend the existing `_resetDocsIndexCache` to clear `cachedCorpus`:

```typescript
export function _resetDocsIndexCache(): void {
  cachedIndex = null;
  cachedCorpus = null;
}
```

The existing `buildDocsIndex()` call inside it must pass `"guide"` and its repo path so the docs search UI keeps compiling.

- [ ] **Step 6: Run the test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/docs-corpus-index.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 7: Run the existing docs tests to catch fallout**

Run: `cd apps/web && npx jest tests/unit/docs-index.test.ts tests/unit/docs-search.test.ts tests/unit/docs.test.tsx tests/unit/docs-client-render.test.tsx tests/unit/docs-deep-links.test.ts`
Expected: PASS. If a test constructs a `DocSection` literal it will now fail to typecheck — add `source: "guide"` and a `repoPath` to those fixtures.

- [ ] **Step 8: Mount the corpus into the web container**

In `docker-compose.yml`, under the `web` service's `volumes:`, add below the existing `./docs/guide` line:

```yaml
      # #990: the docs Ask bubble reads the reference docs and the PRDs at
      # request time. Read-only; the container must never write here.
      - ./docs:/docs:ro
      - ./prds:/prds:ro
```

Remove the now-redundant `./docs/guide:/docs/guide:ro` and `./docs/about.md:/docs/about.md:ro` lines, which `./docs:/docs:ro` supersedes. Leave the `./CHANGELOG.md:/docs/CHANGELOG.md:ro` line alone — it maps a repo-root file into `/docs` and is not covered by the directory mount.

- [ ] **Step 9: Verify the mount serves the existing docs page**

```bash
docker compose build web && docker compose up -d web
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/docs        # 200
curl -s http://localhost:3000/api/docs/08-queue | head -3                  # markdown
```

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib/docs-search.ts apps/web/src/lib/docs-index.ts \
        apps/web/tests/unit/docs-corpus-index.test.ts docker-compose.yml
git commit -m "feat(docs-ask): index reference docs and PRDs alongside the guide (#990)"
```

---

### Task 2: Question-oriented section retrieval

The existing `searchIndex` matches the **whole query** as one substring (`content.indexOf(q)`), which is right for a search box and useless for a question — `"why is Whisper unloaded before pyannote"` matches nothing. This adds a term-based scorer and a budgeted selector. The spec assumed the existing scorer could be reused; it cannot.

**Files:**
- Create: `apps/web/src/lib/docs-retrieval.ts`
- Test: `apps/web/tests/unit/docs-retrieval.test.ts`

**Interfaces:**
- Consumes: `DocSection`, `DocSource` from Task 1
- Produces:
  - `selectSections(question: string, index: DocSection[], opts?: { maxSections?: number; maxTokens?: number }): DocSection[]`
  - `MAX_SECTIONS = 8`, `MAX_CONTEXT_TOKENS = 4000`

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/unit/docs-retrieval.test.ts
import { selectSections, MAX_SECTIONS, MAX_CONTEXT_TOKENS } from "@/lib/docs-retrieval";
import type { DocSection } from "@/lib/docs-search";

function sec(over: Partial<DocSection> = {}): DocSection {
  return {
    docSlug: "08-queue", docTitle: "Queue", sectionId: "s", sectionTitle: "Stages",
    level: 2, content: "words about the queue", source: "guide",
    repoPath: "docs/guide/08-queue.md", ...over,
  } as DocSection;
}

describe("selectSections (#990)", () => {
  it("matches on individual terms, not the whole question", () => {
    // The bug this exists to avoid: searchIndex does content.indexOf(query),
    // so a natural-language question matches nothing at all.
    const index = [
      sec({ sectionId: "a", sectionTitle: "Diarization", content: "Whisper is unloaded before pyannote loads." }),
      sec({ sectionId: "b", sectionTitle: "Export", content: "Download search results as Markdown." }),
    ];
    const got = selectSections("why is Whisper unloaded before pyannote?", index);
    expect(got.map((s) => s.sectionId)).toEqual(["a"]);
  });

  it("ranks a title match above a body-only match", () => {
    const index = [
      sec({ sectionId: "body", sectionTitle: "Other", content: "backups backups backups" }),
      sec({ sectionId: "title", sectionTitle: "Backups", content: "unrelated words" }),
    ];
    const got = selectSections("backups", index);
    expect(got[0].sectionId).toBe("title");
  });

  it("ignores stopwords so common English does not dominate", () => {
    const index = [
      sec({ sectionId: "stop", sectionTitle: "X", content: "the is a of and for" }),
      sec({ sectionId: "real", sectionTitle: "X", content: "pyannote diarization" }),
    ];
    const got = selectSections("what is the diarization for", index);
    expect(got.map((s) => s.sectionId)).toEqual(["real"]);
  });

  it("returns at most MAX_SECTIONS", () => {
    const index = Array.from({ length: 40 }, (_, i) =>
      sec({ sectionId: `s${i}`, content: "pyannote diarization" }),
    );
    expect(selectSections("pyannote", index).length).toBe(MAX_SECTIONS);
  });

  it("stops at the token budget so one long section cannot crowd out the rest", () => {
    const long = sec({ sectionId: "long", content: "pyannote ".repeat(4000) });
    const short = sec({ sectionId: "short", content: "pyannote diarization" });
    const got = selectSections("pyannote", [long, short]);
    const chars = got.reduce((n, s) => n + s.content.length, 0);
    expect(chars / 4).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
  });

  it("returns nothing for a question with no usable terms", () => {
    expect(selectSections("the and of", [sec()])).toEqual([]);
    expect(selectSections("", [sec()])).toEqual([]);
  });

  it("returns nothing when the corpus is empty rather than throwing", () => {
    expect(selectSections("pyannote", [])).toEqual([]);
  });

  it("is deterministic for equally-scoring sections", () => {
    const index = [
      sec({ sectionId: "b", docSlug: "z", content: "pyannote" }),
      sec({ sectionId: "a", docSlug: "z", content: "pyannote" }),
    ];
    expect(selectSections("pyannote", index).map((s) => s.sectionId)).toEqual(["a", "b"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/docs-retrieval.test.ts`
Expected: FAIL — cannot resolve `@/lib/docs-retrieval`

- [ ] **Step 3: Write the implementation**

```typescript
// apps/web/src/lib/docs-retrieval.ts
import type { DocSection } from "./docs-search";

/** At most this many sections go to the model. */
export const MAX_SECTIONS = 8;

/**
 * Character budget expressed in tokens, at the usual ~4 chars/token.
 * The smallest supported local model is qwen2.5:3b at 8192 context, shared
 * with the system prompt and conversation history, so 4000 leaves room.
 */
export const MAX_CONTEXT_TOKENS = 4000;

const CHARS_PER_TOKEN = 4;

/**
 * Words carrying no retrieval signal. Without this, "what is the..." scores
 * every section in the corpus roughly equally.
 */
const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "but", "by", "can", "do", "does",
  "for", "from", "how", "i", "if", "in", "is", "it", "its", "me", "my", "of",
  "on", "or", "should", "that", "the", "then", "there", "these", "this", "to",
  "was", "what", "when", "where", "which", "why", "will", "with", "you", "your",
]);

function terms(question: string): string[] {
  return Array.from(
    new Set(
      question
        .toLowerCase()
        .split(/[^a-z0-9_.-]+/)
        .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
    ),
  );
}

/** Title hits weigh more than body hits: a heading names its subject. */
const TITLE_WEIGHT = 3;
const CONTENT_WEIGHT = 1;

function scoreSection(section: DocSection, qTerms: string[]): number {
  const title = section.sectionTitle.toLowerCase();
  const body = section.content.toLowerCase();
  let score = 0;
  for (const t of qTerms) {
    if (title.includes(t)) score += TITLE_WEIGHT;
    if (body.includes(t)) score += CONTENT_WEIGHT;
  }
  return score;
}

/**
 * Pick the sections most likely to answer `question` (#990).
 *
 * Deliberately not `searchIndex` from docs-search.ts: that matches the whole
 * query as one substring, which is correct for a search box and matches
 * nothing for a natural-language question.
 */
export function selectSections(
  question: string,
  index: DocSection[],
  opts: { maxSections?: number; maxTokens?: number } = {},
): DocSection[] {
  const maxSections = opts.maxSections ?? MAX_SECTIONS;
  const maxChars = (opts.maxTokens ?? MAX_CONTEXT_TOKENS) * CHARS_PER_TOKEN;

  const qTerms = terms(question);
  if (qTerms.length === 0 || index.length === 0) return [];

  const scored = index
    .map((section) => ({ section, score: scoreSection(section, qTerms) }))
    .filter((s) => s.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      // Deterministic tie-break, matching docs-search.ts's convention.
      if (a.section.docSlug !== b.section.docSlug) {
        return a.section.docSlug.localeCompare(b.section.docSlug);
      }
      return a.section.sectionId.localeCompare(b.section.sectionId);
    });

  const out: DocSection[] = [];
  let chars = 0;
  for (const { section } of scored) {
    if (out.length >= maxSections) break;
    const cost = section.content.length;
    if (chars + cost > maxChars) continue; // skip, a shorter one may still fit
    out.push(section);
    chars += cost;
  }
  return out;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/docs-retrieval.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/docs-retrieval.ts apps/web/tests/unit/docs-retrieval.test.ts
git commit -m "feat(docs-ask): question-oriented section retrieval (#990)"
```

---

### Task 3: Accept supplied context in the pipeline Ask endpoint

Lets a caller hand the pipeline the passages to answer from, instead of the pipeline retrieving transcript chunks. Provider routing, prompt assembly and SSE streaming are untouched.

**Files:**
- Modify: `apps/pipeline/app/api/ask.py`
- Modify: `apps/pipeline/app/services/rag.py` (add `build_prompt_from_text`)
- Test: `apps/pipeline/tests/unit/test_ask_supplied_context.py`

**Interfaces:**
- Consumes: nothing from earlier tasks (parallel-safe with Tasks 1–2)
- Produces:
  - `class ContextSection(BaseModel)` with `title: str`, `source: str`, `slug: str`, `anchor: str | None`, `repo_path: str`, `text: str`
  - `AskRequest.context: list[ContextSection] | None = None`
  - `rag.build_prompt_from_text(question, passages: list[str], system_prompt=None, history=None) -> list[dict]`

- [ ] **Step 1: Write the failing test**

```python
# apps/pipeline/tests/unit/test_ask_supplied_context.py
"""#990: /api/ask can answer over caller-supplied passages.

The transcript path must be untouched -- a request without `context`
still retrieves chunks. That regression guard is the point of this file
as much as the new behaviour is.
"""
from unittest.mock import MagicMock, patch

from app.api.ask import AskRequest, ContextSection


class TestAskRequestContext:
    def test_context_defaults_to_none(self):
        req = AskRequest(question="why?")
        assert req.context is None

    def test_context_accepts_sections(self):
        req = AskRequest(
            question="why is Whisper unloaded?",
            context=[
                ContextSection(
                    title="Memory", source="guide", slug="19-inference-providers",
                    anchor="a-note-on-memory", repo_path="docs/guide/19-inference-providers.md",
                    text="Whisper is unloaded before pyannote loads.",
                )
            ],
        )
        assert req.context is not None
        assert req.context[0].source == "guide"


class TestBuildPromptFromText:
    def test_passages_appear_in_the_prompt(self):
        from app.services.rag import build_prompt_from_text

        msgs = build_prompt_from_text(
            "why?", ["Whisper is unloaded before pyannote loads."],
            system_prompt="SYS",
        )
        joined = " ".join(m["content"] for m in msgs)
        assert "Whisper is unloaded" in joined
        assert "why?" in joined

    def test_system_prompt_is_honoured(self):
        from app.services.rag import build_prompt_from_text

        msgs = build_prompt_from_text("q", ["p"], system_prompt="CUSTOM")
        assert msgs[0]["role"] == "system"
        assert msgs[0]["content"] == "CUSTOM"

    def test_history_is_inserted_between_system_and_user(self):
        from app.services.rag import build_prompt_from_text

        msgs = build_prompt_from_text(
            "q", ["p"], system_prompt="SYS",
            history=[{"role": "user", "content": "earlier"}],
        )
        assert msgs[0]["role"] == "system"
        assert msgs[1]["content"] == "earlier"
        assert msgs[-1]["role"] == "user"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/test_ask_supplied_context.py -q`
Expected: FAIL — `ImportError: cannot import name 'ContextSection'`

Note: the test image bakes test files at build time, so it must be rebuilt after every test edit. A test count that does not change is the symptom of forgetting.

- [ ] **Step 3: Add the request model**

In `apps/pipeline/app/api/ask.py`, above `class AskRequest`:

```python
class ContextSection(BaseModel):
    """A documentation passage supplied by the caller (#990).

    When AskRequest.context is present the endpoint answers over these
    instead of retrieving transcript chunks. That makes /api/ask a
    general-purpose "answer over supplied text" endpoint -- see the
    consequences section of the docs-Ask design spec.
    """
    title: str
    source: str          # guide | reference | prd
    slug: str
    anchor: str | None = None
    repo_path: str
    text: str
```

And on `AskRequest`:

```python
    # #990: documentation passages supplied by the web app, which is the only
    # container with the docs mounted. Present => skip transcript retrieval.
    context: list[ContextSection] | None = None
```

- [ ] **Step 4: Add the prompt builder**

In `apps/pipeline/app/services/rag.py`, next to `build_prompt`:

```python
def build_prompt_from_text(
    question: str,
    passages: list[str],
    system_prompt: str | None = None,
    history: list[dict] | None = None,
) -> list[dict]:
    """Build chat messages from caller-supplied passages (#990).

    Mirrors build_prompt's message shape exactly -- system, then prior
    turns, then the user turn with context inline -- so the provider paths
    downstream cannot tell the two apart.
    """
    context_block = "\n\n---\n\n".join(passages)
    messages: list[dict] = [
        {"role": "system", "content": system_prompt or SYSTEM_PROMPT}
    ]
    if history:
        messages.extend(history)
    messages.append(
        {
            "role": "user",
            "content": f"Context:\n\n{context_block}\n\nQuestion: {question}",
        }
    )
    return messages
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/unit/test_ask_supplied_context.py -q`
Expected: PASS (5 tests)

- [ ] **Step 6: Give the generator a context parameter**

`_stream_ask` takes individual arguments, not the request object. Add a
parameter to its signature (`apps/pipeline/app/api/ask.py:67`), after
`history`:

```python
async def _stream_ask(
    question: str,
    model: str | None,
    feed_ids: list[str] | None,
    episode_id: str | None = None,
    speaker_display: str | None = None,
    history: list[dict] | None = None,
    context: list["ContextSection"] | None = None,
):
```

And pass it at the call site in `ask_endpoint`, alongside the existing
keyword arguments:

```python
            history=history,
            context=req.context,
```

- [ ] **Step 7: Branch on supplied context**

Inside `_stream_ask`, the retrieval block currently reads:

```python
        # 1. Retrieve relevant chunks
        chunks = retrieve_chunks(
            db, question, feed_ids=feed_ids, episode_id=episode_id,
            speaker_display=speaker_display,
        )

        if not chunks:
            yield _sse_event("error", {"message": "No relevant transcript excerpts found for your question."})
            yield _sse_event("done", {})
            return

        # 2. Send sources first
        sources = chunks_to_sources(chunks)
        yield _sse_event("sources", sources)
```

Put the supplied-context branch in front of it, leaving that block as the
`else`. The two branches converge on `messages`, which the existing
streaming code below already consumes:

```python
        if context:
            # #990: the caller supplied the passages, so there is nothing to
            # retrieve. The web app does that, being the only container with
            # the documentation mounted.
            yield _sse_event(
                "sources",
                [
                    {
                        "title": c.title,
                        "source": c.source,
                        "slug": c.slug,
                        "anchor": c.anchor,
                        "repo_path": c.repo_path,
                        "text": c.text[:200],
                    }
                    for c in context
                ],
            )
            messages = build_prompt_from_text(
                question,
                [c.text for c in context],
                system_prompt=get_prompt(db, "ask_page_system"),
                history=(history or [])[-MAX_HISTORY_MESSAGES:],
            )
        else:
            <the existing block above, unchanged, followed by the existing
             prompt_key / system_prompt / capped_history / build_prompt lines>
```

Import `build_prompt_from_text` alongside the existing `build_prompt`
import at the top of the file.

An empty `context` list is not special-cased here: Task 4's route returns
the "no documentation matched" stream without calling the pipeline at
all, so this branch is only reached with passages in hand.

- [ ] **Step 8: Add the regression guard for the transcript path**

`_stream_ask` is an async generator, so the test must drain it with
`async for`. Append to `apps/pipeline/tests/unit/test_ask_supplied_context.py`:

```python
import pytest


class TestTranscriptPathUnchanged:
    """The branch must not disturb /ask. This is the guard for that."""

    async def _drain(self, gen):
        return [frame async for frame in gen]

    @pytest.mark.asyncio
    async def test_no_context_still_retrieves_chunks(self):
        from app.api import ask as ask_mod

        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value={}),
            patch.object(ask_mod, "retrieve_chunks", return_value=[]) as mock_ret,
        ):
            await self._drain(ask_mod._stream_ask("carbon pricing", None, None))

        mock_ret.assert_called_once()

    @pytest.mark.asyncio
    async def test_supplied_context_skips_retrieval(self):
        from app.api import ask as ask_mod

        section = ContextSection(
            title="Memory", source="guide", slug="19-inference-providers",
            anchor="a-note-on-memory",
            repo_path="docs/guide/19-inference-providers.md",
            text="Whisper is unloaded before pyannote loads.",
        )
        with (
            patch.object(ask_mod, "SessionLocal", return_value=MagicMock()),
            patch.object(ask_mod, "get_runtime_inference_settings", return_value={}),
            patch.object(ask_mod, "get_prompt", return_value="SYS"),
            patch.object(ask_mod, "retrieve_chunks") as mock_ret,
        ):
            frames = await self._drain(
                ask_mod._stream_ask("why?", None, None, context=[section])
            )

        mock_ret.assert_not_called()
        assert any("a-note-on-memory" in f for f in frames)
```

`asyncio_mode = "auto"` is already set in `pyproject.toml`, so the
`@pytest.mark.asyncio` decorators are belt-and-braces rather than required.

- [ ] **Step 9: Run the full pipeline unit suite**

Run: `docker compose -f docker-compose.test.yml build test && docker compose -f docker-compose.test.yml run --rm test pytest tests/unit -q`
Expected: PASS, count increased by 7

- [ ] **Step 10: Commit**

```bash
git add apps/pipeline/app/api/ask.py apps/pipeline/app/services/rag.py \
        apps/pipeline/tests/unit/test_ask_supplied_context.py
git commit -m "feat(docs-ask): accept caller-supplied context in /api/ask (#990)"
```

---

### Task 4: The `/api/docs/ask` route

Joins the two halves: retrieve in the web app, generate in the pipeline, stream the result straight back.

**Files:**
- Create: `apps/web/src/app/api/docs/ask/route.ts`
- Test: `apps/web/tests/unit/docs-ask-route.test.ts`

**Interfaces:**
- Consumes: `buildDocsCorpusIndex` (Task 1), `selectSections` (Task 2), `ContextSection` shape (Task 3)
- Produces: `POST /api/docs/ask` accepting `{ question: string, model?: string, history?: {role,content}[] }` and returning an SSE stream

- [ ] **Step 1: Write the failing test**

```typescript
// apps/web/tests/unit/docs-ask-route.test.ts
/** @jest-environment node */
import { POST } from "@/app/api/docs/ask/route";

jest.mock("@/lib/docs-index", () => ({
  buildDocsCorpusIndex: jest.fn(async () => [
    {
      docSlug: "19-inference-providers", docTitle: "Inference Providers",
      sectionId: "a-note-on-memory", sectionTitle: "A note on memory",
      level: 2, content: "Whisper is unloaded before pyannote loads.",
      source: "guide", repoPath: "docs/guide/19-inference-providers.md",
    },
  ]),
}));

function req(body: unknown) {
  return new Request("http://localhost/api/docs/ask", {
    method: "POST", body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("POST /api/docs/ask (#990)", () => {
  afterEach(() => jest.restoreAllMocks());

  it("forwards the retrieved sections to the pipeline as context", async () => {
    const fetchMock = jest.fn(async () => new Response("data: {}\n\n", { status: 200 }));
    global.fetch = fetchMock as unknown as typeof fetch;

    await POST(req({ question: "why is Whisper unloaded before pyannote?" }));

    const [, init] = fetchMock.mock.calls[0];
    const sent = JSON.parse((init as RequestInit).body as string);
    expect(sent.context).toHaveLength(1);
    expect(sent.context[0].slug).toBe("19-inference-providers");
    expect(sent.context[0].anchor).toBe("a-note-on-memory");
    expect(sent.context[0].source).toBe("guide");
  });

  it("answers 400 for a missing question rather than calling the pipeline", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const resp = await POST(req({}));
    expect(resp.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("reports no match instead of asking the model to guess", async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;

    const resp = await POST(req({ question: "zzzz qqqq" }));
    const text = await resp.text();
    expect(text).toContain("No documentation matched");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a pipeline failure rather than hanging the stream", async () => {
    global.fetch = jest.fn(async () => new Response("boom", { status: 502 })) as unknown as typeof fetch;

    const resp = await POST(req({ question: "pyannote diarization" }));
    expect(resp.status).toBe(502);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/docs-ask-route.test.ts`
Expected: FAIL — cannot resolve `@/app/api/docs/ask/route`

- [ ] **Step 3: Write the route**

```typescript
// apps/web/src/app/api/docs/ask/route.ts
import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";
import { buildDocsCorpusIndex } from "@/lib/docs-index";
import { selectSections } from "@/lib/docs-retrieval";

export const dynamic = "force-dynamic";

/**
 * POST /api/docs/ask — Ask over the documentation (#990).
 *
 * Retrieval happens here because this is the only container with the docs
 * mounted; generation happens in the pipeline, which owns provider routing
 * and streaming. The passages travel in the request body.
 */
export async function POST(req: Request) {
  let body: { question?: string; model?: string; history?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const question = (body.question ?? "").trim();
  if (!question) {
    return NextResponse.json({ error: "question is required" }, { status: 400 });
  }

  const index = await buildDocsCorpusIndex();
  const sections = selectSections(question, index);

  if (sections.length === 0) {
    // Better an honest miss than a confident answer from nothing.
    const sse =
      `event: error\ndata: ${JSON.stringify({ message: "No documentation matched your question." })}\n\n` +
      `event: done\ndata: {}\n\n`;
    return new Response(sse, {
      status: 200,
      headers: { "Content-Type": "text/event-stream" },
    });
  }

  const resp = await fetch(`${PIPELINE_API}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      question,
      model: body.model,
      history: body.history,
      context: sections.map((s) => ({
        title: s.sectionTitle || s.docTitle,
        source: s.source,
        slug: s.docSlug,
        anchor: s.sectionId || null,
        repo_path: s.repoPath,
        text: s.content,
      })),
    }),
  });

  if (!resp.ok || !resp.body) {
    return NextResponse.json(
      { error: `Pipeline returned ${resp.status}` },
      { status: resp.status || 502 },
    );
  }

  return new Response(resp.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/docs-ask-route.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/docs/ask/route.ts apps/web/tests/unit/docs-ask-route.test.ts
git commit -m "feat(docs-ask): add the /api/docs/ask retrieval route (#990)"
```

---

### Task 5: The bubble, citations and documentation

The user-visible half: a chat bubble on `/docs` that streams answers and links each citation to the heading it came from.

**Files:**
- Create: `apps/web/src/components/DocsAskBubble.tsx`
- Modify: `apps/web/src/app/docs/DocsClient.tsx` (mount the bubble)
- Modify: `docs/guide/README.md` (mention it in the guide index)
- Modify: `CHANGELOG.md`
- Test: `apps/web/tests/unit/docs-ask-bubble.test.tsx`

**Interfaces:**
- Consumes: `POST /api/docs/ask` (Task 4)
- Produces: `<DocsAskBubble />`, no props

- [ ] **Step 1: Write the failing test**

```tsx
// apps/web/tests/unit/docs-ask-bubble.test.tsx
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DocsAskBubble from "@/components/DocsAskBubble";

function sseResponse(events: string) {
  return new Response(events, {
    status: 200, headers: { "Content-Type": "text/event-stream" },
  });
}

describe("DocsAskBubble (#990)", () => {
  it("is collapsed until opened", () => {
    render(<DocsAskBubble />);
    expect(screen.getByRole("button", { name: /ask about the docs/i })).toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/ask a question/i)).toBeNull();
  });

  it("streams an answer and shows it", async () => {
    global.fetch = jest.fn(async () =>
      sseResponse(
        `event: token\ndata: {"text":"Whisper "}\n\n` +
        `event: token\ndata: {"text":"is unloaded."}\n\n` +
        `event: done\ndata: {}\n\n`,
      ),
    ) as unknown as typeof fetch;

    render(<DocsAskBubble />);
    fireEvent.click(screen.getByRole("button", { name: /ask about the docs/i }));
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
      target: { value: "why is Whisper unloaded?" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText(/Whisper is unloaded\./)).toBeInTheDocument(),
    );
  });

  it("deep-links a guide citation to its heading", async () => {
    global.fetch = jest.fn(async () =>
      sseResponse(
        `event: sources\ndata: [{"title":"A note on memory","source":"guide","slug":"19-inference-providers","anchor":"a-note-on-memory","repo_path":"docs/guide/19-inference-providers.md","text":"..."}]\n\n` +
        `event: done\ndata: {}\n\n`,
      ),
    ) as unknown as typeof fetch;

    render(<DocsAskBubble />);
    fireEvent.click(screen.getByRole("button", { name: /ask about the docs/i }));
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
      target: { value: "memory" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /A note on memory/ });
      expect(link).toHaveAttribute(
        "href",
        "/docs?page=19-inference-providers#a-note-on-memory",
      );
    });
  });

  it("links a PRD citation to the repository, since PRDs are not rendered", async () => {
    global.fetch = jest.fn(async () =>
      sseResponse(
        `event: sources\ndata: [{"title":"Memory","source":"prd","slug":"PRD-01-ingestion-pipeline","anchor":null,"repo_path":"prds/PRD-01-ingestion-pipeline.md","text":"..."}]\n\n` +
        `event: done\ndata: {}\n\n`,
      ),
    ) as unknown as typeof fetch;

    render(<DocsAskBubble />);
    fireEvent.click(screen.getByRole("button", { name: /ask about the docs/i }));
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
      target: { value: "memory" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      const link = screen.getByRole("link", { name: /Memory/ });
      expect(link).toHaveAttribute(
        "href",
        "https://github.com/brlauuu/podlog/blob/main/prds/PRD-01-ingestion-pipeline.md",
      );
    });
  });

  it("shows the error text when the stream reports one", async () => {
    global.fetch = jest.fn(async () =>
      sseResponse(
        `event: error\ndata: {"message":"No documentation matched your question."}\n\n` +
        `event: done\ndata: {}\n\n`,
      ),
    ) as unknown as typeof fetch;

    render(<DocsAskBubble />);
    fireEvent.click(screen.getByRole("button", { name: /ask about the docs/i }));
    fireEvent.change(screen.getByPlaceholderText(/ask a question/i), {
      target: { value: "zzzz" },
    });
    fireEvent.click(screen.getByRole("button", { name: /^send$/i }));

    await waitFor(() =>
      expect(screen.getByText(/No documentation matched/)).toBeInTheDocument(),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/docs-ask-bubble.test.tsx`
Expected: FAIL — cannot resolve `@/components/DocsAskBubble`

- [ ] **Step 3: Write the citation helper**

Add to `apps/web/src/lib/docs-retrieval.ts`:

```typescript
const REPO_BLOB_BASE_URL = "https://github.com/brlauuu/podlog/blob/main";

/**
 * Where a cited section lives. Guide pages are rendered at /docs and get a
 * deep link to the exact heading; PRDs and reference docs have no rendered
 * surface, so they cite to the repository — the same convention
 * DocsClient's resolveMarkdownHref already uses for non-guide links.
 */
export function citationHref(source: string, slug: string, anchor: string | null, repoPath: string): string {
  if (source === "guide") {
    return `/docs?page=${encodeURIComponent(slug)}${anchor ? `#${anchor}` : ""}`;
  }
  return `${REPO_BLOB_BASE_URL}/${repoPath}`;
}
```

- [ ] **Step 4: Write the component**

Read `apps/web/src/components/EpisodeChat.tsx` first and follow its
structure — open/closed state, message list, `resp.body.getReader()` loop,
SSE frame parser, `DEFAULT_RAG_MODEL` handling. Do not invent a second
pattern for any of that.

Only three things differ, and all three are below in full.

**The request** (no `episode_id`, different endpoint):

```tsx
const resp = await fetch("/api/docs/ask", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    question: trimmed,
    model,
    history: messages.map((m) => ({ role: m.role, content: m.content })),
  }),
});
```

**The source type and its state**, replacing EpisodeChat's transcript sources:

```tsx
interface DocSourceRef {
  title: string;
  source: string;
  slug: string;
  anchor: string | null;
  repo_path: string;
  text: string;
}

const [sources, setSources] = useState<DocSourceRef[]>([]);
```

In the frame parser, the `sources` event sets it directly:

```tsx
if (event === "sources") {
  setSources(JSON.parse(data) as DocSourceRef[]);
  continue;
}
```

**The citation list**, rendered under the answer:

```tsx
{sources.length > 0 && (
  <ul className="mt-2 space-y-1 text-xs">
    {sources.map((s) => (
      <li key={`${s.repo_path}#${s.anchor ?? ""}`}>
        <a
          href={citationHref(s.source, s.slug, s.anchor, s.repo_path)}
          className="text-link hover:underline"
          {...(s.source === "guide"
            ? {}
            : { target: "_blank", rel: "noreferrer" })}
        >
          {s.title}
        </a>
        <span className="ml-1 text-muted-foreground">
          {s.source === "guide" ? "guide" : s.source === "prd" ? "design doc" : "reference"}
        </span>
      </li>
    ))}
  </ul>
)}
```

Import `citationHref` from `@/lib/docs-retrieval`. A guide citation
navigates in place (it is a `/docs` link); the others open a new tab
because they leave the app for GitHub.

**Copy**, exactly as the tests assert it: trigger button `Ask about the
docs`, input placeholder `Ask a question about Podlog…`, submit button
`Send`.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/docs-ask-bubble.test.tsx`
Expected: PASS (5 tests)

- [ ] **Step 6: Mount the bubble on the docs page**

In `apps/web/src/app/docs/DocsClient.tsx`, import `DocsAskBubble` and render it once at the end of the component's returned tree, outside the scrolling content so it stays fixed:

```tsx
      <DocsAskBubble />
```

- [ ] **Step 7: Document it**

In `docs/guide/README.md`, add to the intro paragraph after the contents list:

```markdown
Every docs page has an **Ask about the docs** bubble in the corner. It answers
questions about Podlog itself — how to configure something, or why it works the
way it does — from this guide, the reference documentation and the design
documents, and cites the exact section each answer came from. It is separate
from [Ask AI](12-rag-search.md), which searches your podcast transcripts.
```

- [ ] **Step 8: Add the CHANGELOG entry**

Under `## Unreleased`, in `### Major changes`:

```markdown
- The documentation now has its own Ask box. Open any docs page and the bubble in the corner answers questions about Podlog itself — how to configure something, why it behaves the way it does — drawing on the user guide, the reference documentation and the design documents, and linking to the exact section each answer came from. It is separate from Ask AI, which searches your podcast transcripts. It works the same on a local install as on remote inference, because it sends only the handful of relevant sections rather than the whole manual. ([#990](https://github.com/brlauuu/podlog/issues/990))
```

- [ ] **Step 9: Verify the whole thing end to end**

```bash
make ci-local
docker compose build web && docker compose up -d web
```

Then open `http://localhost:3000/docs`, click **Ask about the docs**, and ask *"why is Whisper unloaded before pyannote?"*. Confirm the answer streams and the citation links to `/docs?page=19-inference-providers#…`. Repeat with a design question — *"why is there no auth on the pipeline API?"* — and confirm the citation points at the repository.

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/components/DocsAskBubble.tsx \
        apps/web/src/app/docs/DocsClient.tsx \
        apps/web/src/lib/docs-retrieval.ts \
        apps/web/tests/unit/docs-ask-bubble.test.tsx \
        docs/guide/README.md CHANGELOG.md
git commit -m "feat(docs-ask): docs Ask bubble with section citations (#990)"
```

---

## Notes for the executor

- **The test image bakes test files.** After editing any pipeline test, rebuild with `docker compose -f docker-compose.test.yml build test` before running. An unchanged test count is the symptom of forgetting.
- **`make ci-local`** runs every blocking CI check with CI's own commands, including the two coverage gates. Run it before pushing.
- **Tasks 1–2 and Task 3 are independent** and can be done in either order. Task 4 needs 1–3; Task 5 needs 4.
- **Do not change the transcript Ask path.** Task 3 Step 7 is the guard; if it fails, the branch is wrong.
