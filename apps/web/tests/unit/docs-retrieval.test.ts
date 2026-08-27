/**
 * @jest-environment node
 *
 * #990: picking the documentation sections that answer a question.
 */
import {
  selectSections,
  MAX_SECTIONS,
  MAX_CONTEXT_TOKENS,
} from "@/lib/docs-retrieval";
import type { DocSection } from "@/lib/docs-search";

function sec(over: Partial<DocSection> = {}): DocSection {
  return {
    docSlug: "08-queue",
    docTitle: "Queue",
    sectionId: "s",
    sectionTitle: "Stages",
    level: 2,
    content: "words about the queue",
    source: "guide",
    repoPath: "docs/guide/08-queue.md",
    ...over,
  } as DocSection;
}

describe("selectSections (#990)", () => {
  it("matches on individual terms, not the whole question", () => {
    // The trap this exists to avoid: docs-search.ts's searchIndex does
    // content.indexOf(wholeQuery), which is right for a search box and
    // matches nothing at all for a natural-language question.
    const index = [
      sec({
        sectionId: "a",
        sectionTitle: "Diarization",
        content: "Whisper is unloaded before pyannote loads.",
      }),
      sec({
        sectionId: "b",
        sectionTitle: "Export",
        content: "Download search results as Markdown.",
      }),
    ];
    const got = selectSections("why is Whisper unloaded before pyannote?", index);
    expect(got.map((s) => s.sectionId)).toEqual(["a"]);
  });

  it("ranks a title match above a body-only match", () => {
    const index = [
      sec({ sectionId: "body", sectionTitle: "Other", content: "backups backups" }),
      sec({ sectionId: "title", sectionTitle: "Backups", content: "unrelated words" }),
    ];
    expect(selectSections("backups", index)[0].sectionId).toBe("title");
  });

  it("ignores stopwords so common English does not dominate", () => {
    const index = [
      sec({ sectionId: "stop", sectionTitle: "X", content: "the is a of and for" }),
      sec({ sectionId: "real", sectionTitle: "X", content: "pyannote diarization" }),
    ];
    expect(selectSections("what is the diarization for", index).map((s) => s.sectionId))
      .toEqual(["real"]);
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

  it("still returns the short section when a long one is skipped", () => {
    // Skipping an over-budget section must not abandon the rest of the list.
    const long = sec({ sectionId: "long", content: "pyannote ".repeat(4000) });
    const short = sec({ sectionId: "short", content: "pyannote diarization" });
    expect(selectSections("pyannote", [long, short]).map((s) => s.sectionId))
      .toContain("short");
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

  it("searches PRDs and reference docs, not just the guide", () => {
    const index = [
      sec({ sectionId: "g", source: "guide", content: "nothing relevant" }),
      sec({
        sectionId: "p",
        source: "prd",
        repoPath: "prds/PRD-01-ingestion-pipeline.md",
        sectionTitle: "Memory constraint",
        content: "Whisper and pyannote never coexist in memory.",
      }),
    ];
    expect(selectSections("memory constraint", index).map((s) => s.sectionId))
      .toEqual(["p"]);
  });
});

describe("against the real corpus (#990)", () => {
  // Deliberately does not assert *which* sections come back -- that would
  // break every time the documentation is edited. It pins the properties
  // that must hold whatever the docs say.
  const REALISTIC_QUESTIONS = [
    "why is Whisper unloaded before pyannote?",
    "how do I add only some episodes from a feed?",
    "what does ARCHIVE_AUDIO do?",
    "how much disk space do I need?",
  ];

  it.each(REALISTIC_QUESTIONS)("retrieves something within budget for: %s", async (q) => {
    const { buildDocsCorpusIndex, _resetDocsIndexCache } = await import("@/lib/docs-index");
    _resetDocsIndexCache();
    const index = await buildDocsCorpusIndex();

    const got = selectSections(q, index);
    expect(got.length).toBeGreaterThan(0);
    expect(got.length).toBeLessThanOrEqual(MAX_SECTIONS);

    const tokens = got.reduce((n, s) => n + s.content.length, 0) / 4;
    expect(tokens).toBeLessThanOrEqual(MAX_CONTEXT_TOKENS);
  });

  it("fits the smallest supported local model with room to spare", async () => {
    // qwen2.5:3b is 8192 ctx, shared with the system prompt and history.
    const { buildDocsCorpusIndex, _resetDocsIndexCache } = await import("@/lib/docs-index");
    _resetDocsIndexCache();
    const index = await buildDocsCorpusIndex();

    const worst = Math.max(
      ...REALISTIC_QUESTIONS.map((q) =>
        selectSections(q, index).reduce((n, s) => n + s.content.length, 0) / 4,
      ),
    );
    expect(worst).toBeLessThan(4096);
  });
});
