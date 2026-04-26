/**
 * @jest-environment node
 */
import {
  searchIndex,
  makeSnippet,
  type DocSection,
} from "@/lib/docs-search";
import { splitDocIntoSections } from "@/lib/docs-index";

const mkSection = (
  partial: Partial<DocSection> & { docSlug: string; sectionId: string },
): DocSection => ({
  docSlug: partial.docSlug,
  docTitle: partial.docTitle ?? "Doc",
  sectionId: partial.sectionId,
  sectionTitle: partial.sectionTitle ?? "Section",
  level: partial.level ?? 2,
  content: partial.content ?? "",
});

describe("searchIndex", () => {
  const corpus: DocSection[] = [
    mkSection({
      docSlug: "01-installation",
      docTitle: "Installation",
      sectionId: "docker",
      sectionTitle: "Docker setup",
      content: "Run docker compose up -d to start the stack.",
    }),
    mkSection({
      docSlug: "06-speakers",
      docTitle: "Speakers",
      sectionId: "renaming",
      sectionTitle: "Renaming a speaker",
      content: "Click the speaker label and type a new name.",
    }),
    mkSection({
      docSlug: "06-speakers",
      docTitle: "Speakers",
      sectionId: "merging",
      sectionTitle: "Merging speakers",
      content: "Use the speaker merge tool to combine two speaker labels.",
    }),
  ];

  it("returns empty for whitespace-only query", () => {
    expect(searchIndex("", corpus)).toEqual([]);
    expect(searchIndex("   ", corpus)).toEqual([]);
  });

  it("matches on section title (case-insensitive)", () => {
    const hits = searchIndex("DOCKER", corpus);
    expect(hits).toHaveLength(1);
    expect(hits[0].section.sectionId).toBe("docker");
    expect(hits[0].matchedIn).toBe("title");
  });

  it("matches on content when title doesn't match", () => {
    const hits = searchIndex("compose up", corpus);
    expect(hits).toHaveLength(1);
    expect(hits[0].section.sectionId).toBe("docker");
    expect(hits[0].matchedIn).toBe("content");
  });

  it("ranks title matches before content matches", () => {
    // 'speaker' appears in section titles AND content of multiple sections.
    const hits = searchIndex("speaker", corpus);
    // First two should be title matches.
    expect(hits.slice(0, 2).every((h) => h.matchedIn === "title")).toBe(true);
    // Section titles "Renaming a speaker" and "Merging speakers" both match.
    expect(hits.slice(0, 2).map((h) => h.section.sectionId).sort()).toEqual([
      "merging",
      "renaming",
    ]);
  });

  it("returns no hits when nothing matches", () => {
    expect(searchIndex("nonexistent_token_xyz", corpus)).toEqual([]);
  });

  it("orders ties deterministically by docSlug then sectionId", () => {
    const dup: DocSection[] = [
      mkSection({ docSlug: "z", sectionId: "b", sectionTitle: "X", content: "x" }),
      mkSection({ docSlug: "a", sectionId: "b", sectionTitle: "X", content: "x" }),
      mkSection({ docSlug: "a", sectionId: "a", sectionTitle: "X", content: "x" }),
    ];
    const hits = searchIndex("x", dup);
    expect(hits.map((h) => `${h.section.docSlug}#${h.section.sectionId}`)).toEqual([
      "a#a",
      "a#b",
      "z#b",
    ]);
  });
});

describe("makeSnippet", () => {
  it("returns empty match for non-matching content", () => {
    const snippet = makeSnippet("hello world", "missing");
    expect(snippet.match).toBe("");
  });

  it("preserves the matched substring exactly (case from source)", () => {
    const snippet = makeSnippet("Hello World", "world");
    // Match should be from the SOURCE casing, not the query.
    expect(snippet.match).toBe("World");
  });

  it("trims around the match with ellipses", () => {
    const longContent =
      "a".repeat(200) + " needle " + "b".repeat(200);
    const snippet = makeSnippet(longContent, "needle", 30);
    expect(snippet.before.startsWith("…")).toBe(true);
    expect(snippet.after.endsWith("…")).toBe(true);
    expect(snippet.match).toBe("needle");
  });

  it("does not prepend ellipsis when match is at the start", () => {
    const snippet = makeSnippet("needle in haystack", "needle");
    expect(snippet.before.startsWith("…")).toBe(false);
  });

  it("does not append ellipsis when match is near the end", () => {
    const snippet = makeSnippet("haystack and needle", "needle");
    expect(snippet.after.endsWith("…")).toBe(false);
  });

  it("collapses internal whitespace for compact display", () => {
    const snippet = makeSnippet(
      "before  \n  match\n\n  after",
      "match",
    );
    expect(snippet.before).not.toContain("\n");
    expect(snippet.after).not.toContain("\n");
  });
});

describe("splitDocIntoSections", () => {
  it("splits at ## and ### headings, preserving section titles", () => {
    const md = [
      "Preamble paragraph.",
      "",
      "## First section",
      "First section body.",
      "",
      "### Subsection",
      "Subsection body.",
      "",
      "## Second section",
      "Second section body.",
    ].join("\n");

    const sections = splitDocIntoSections("test-doc", "Test", md);
    expect(sections.map((s) => s.sectionTitle)).toEqual([
      "",
      "First section",
      "Subsection",
      "Second section",
    ]);
    expect(sections[0].level).toBe(0);
    expect(sections[1].level).toBe(2);
    expect(sections[2].level).toBe(3);
    expect(sections[3].level).toBe(2);
  });

  it("emits unique sectionIds for repeated heading text", () => {
    const md = "## Setup\nBody A\n\n## Setup\nBody B\n";
    const sections = splitDocIntoSections("d", "D", md);
    const ids = sections.filter((s) => s.level === 2).map((s) => s.sectionId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("skips empty preambles", () => {
    const md = "## Only section\nBody\n";
    const sections = splitDocIntoSections("d", "D", md);
    expect(sections).toHaveLength(1);
    expect(sections[0].sectionTitle).toBe("Only section");
  });

  it("preserves docSlug and docTitle on every section", () => {
    const md = "## A\n\n## B\n";
    const sections = splitDocIntoSections("my-slug", "My Title", md);
    expect(sections.every((s) => s.docSlug === "my-slug")).toBe(true);
    expect(sections.every((s) => s.docTitle === "My Title")).toBe(true);
  });
});
