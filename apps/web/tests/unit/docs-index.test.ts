/**
 * Tests for lib/docs-index (#673). Covers the pure section splitter
 * directly, plus buildDocsIndex end-to-end against a mocked
 * filesystem (readdir + readFile).
 *
 * @jest-environment node
 */
const mockReaddir = jest.fn();
const mockReadFile = jest.fn();

jest.mock("fs/promises", () => ({
  readdir: (...args: unknown[]) => mockReaddir(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
}));

import {
  buildDocsIndex,
  splitDocIntoSections,
  _resetDocsIndexCache,
} from "@/lib/docs-index";

beforeEach(() => {
  mockReaddir.mockReset();
  mockReadFile.mockReset();
  _resetDocsIndexCache();
});

describe("splitDocIntoSections", () => {
  it("captures preamble + ## + ### sections with slugified anchors", () => {
    const md = [
      "Preamble paragraph.",
      "",
      "## First Section",
      "Body of first.",
      "",
      "### Sub Heading",
      "Sub body.",
      "",
      "## Second Section",
      "Second body.",
    ].join("\n");

    const sections = splitDocIntoSections("getting-started", "Getting Started", md);

    expect(sections).toHaveLength(4);
    expect(sections[0]).toMatchObject({
      docSlug: "getting-started",
      docTitle: "Getting Started",
      sectionId: "",
      sectionTitle: "",
      level: 0,
      content: "Preamble paragraph.",
    });
    expect(sections[1]).toMatchObject({
      sectionId: "first-section",
      sectionTitle: "First Section",
      level: 2,
    });
    expect(sections[2]).toMatchObject({
      sectionId: "sub-heading",
      sectionTitle: "Sub Heading",
      level: 3,
    });
    expect(sections[3]).toMatchObject({
      sectionId: "second-section",
      level: 2,
    });
  });

  it("disambiguates duplicate headings via the unique slugger", () => {
    const md = [
      "## Same",
      "first",
      "## Same",
      "second",
    ].join("\n");
    const sections = splitDocIntoSections("dup", "Dup", md);
    expect(sections.map((s) => s.sectionId)).toEqual(["same", "same-1"]);
  });
});

describe("buildDocsIndex", () => {
  it("walks .md files in order and builds the flat section index", async () => {
    mockReaddir.mockResolvedValue([
      "02-architecture.md",
      "01-getting-started.md",
      "ignored.txt",
    ]);
    mockReadFile.mockImplementation((p: string) => {
      if (p.endsWith("01-getting-started.md")) {
        return Promise.resolve("Preamble\n\n## Setup\nsetup body");
      }
      return Promise.resolve("## Layers\nlayer body");
    });

    const sections = await buildDocsIndex();

    // Files are read in sorted order: 01-* first, then 02-*.
    const slugs = sections.map((s) => s.docSlug);
    expect(slugs).toEqual([
      "01-getting-started",
      "01-getting-started",
      "02-architecture",
    ]);
    const titles = sections.map((s) => s.docTitle);
    expect(titles[0]).toBe("Getting Started");
    expect(titles[2]).toBe("Architecture");
  });

  it("memoizes the result across calls until the cache is reset", async () => {
    mockReaddir.mockResolvedValue(["01-doc.md"]);
    mockReadFile.mockResolvedValue("## Heading\nbody");

    const first = await buildDocsIndex();
    const second = await buildDocsIndex();

    expect(second).toBe(first); // same reference — memoized
    expect(mockReaddir).toHaveBeenCalledTimes(1);

    _resetDocsIndexCache();
    await buildDocsIndex();
    expect(mockReaddir).toHaveBeenCalledTimes(2);
  });

  it("returns [] when the docs directory cannot be read", async () => {
    mockReaddir.mockRejectedValue(new Error("ENOENT"));
    const sections = await buildDocsIndex();
    expect(sections).toEqual([]);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it("skips files whose readFile fails but keeps others", async () => {
    mockReaddir.mockResolvedValue(["01-good.md", "02-bad.md"]);
    mockReadFile.mockImplementation((p: string) => {
      if (p.endsWith("02-bad.md")) return Promise.reject(new Error("nope"));
      return Promise.resolve("## A\nA body");
    });

    const sections = await buildDocsIndex();
    const slugs = new Set(sections.map((s) => s.docSlug));
    expect(slugs.has("01-good")).toBe(true);
    expect(slugs.has("02-bad")).toBe(false);
  });
});
