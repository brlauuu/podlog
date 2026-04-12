/**
 * @jest-environment node
 */

import { buildNormalizedQuery, parseSearchQuery } from "@/lib/search/queryParser";

describe("parseSearchQuery", () => {
  test("keeps plain query as transcript_hybrid free text", () => {
    const parsed = parseSearchQuery("crisis in Iran");
    expect(parsed.freeText).toBe("crisis in Iran");
    expect(parsed.titleFilter).toBeNull();
    expect(parsed.descriptionFilter).toBeNull();
    expect(parsed.speakerFilter).toBeNull();
    expect(parsed.mode).toBe("transcript_hybrid");
  });

  test("parses title-only query as metadata_only", () => {
    const parsed = parseSearchQuery("title:What the Heck is Happening in China");
    expect(parsed.freeText).toBe("");
    expect(parsed.titleFilter).toBe("What the Heck is Happening in China");
    expect(parsed.mode).toBe("metadata_only");
  });

  test("parses quoted scoped values", () => {
    const parsed = parseSearchQuery('title:"What the Heck is Happening in China" description:"iran crisis"');
    expect(parsed.titleFilter).toBe("What the Heck is Happening in China");
    expect(parsed.descriptionFilter).toBe("iran crisis");
    expect(parsed.mode).toBe("metadata_only");
  });

  test("parses case-insensitive scope names", () => {
    const parsed = parseSearchQuery("TITLE:china SPEAKER:jacob");
    expect(parsed.titleFilter).toBe("china");
    expect(parsed.speakerFilter).toBe("jacob");
    expect(parsed.mode).toBe("metadata_only");
  });

  test("parses mixed free text and speaker scope as transcript_hybrid", () => {
    const parsed = parseSearchQuery("crisis in Iran speaker: Jacob Shapiro");
    expect(parsed.freeText).toBe("crisis in Iran");
    expect(parsed.speakerFilter).toBe("Jacob Shapiro");
    expect(parsed.mode).toBe("transcript_hybrid");
  });

  test("combines multiple same-scope values", () => {
    const parsed = parseSearchQuery("speaker: jacob speaker: shapiro");
    expect(parsed.speakerFilter).toBe("jacob shapiro");
    expect(parsed.mode).toBe("metadata_only");
  });

  test("treats empty scoped tokens as free text", () => {
    const parsed = parseSearchQuery("title: speaker:   ");
    expect(parsed.titleFilter).toBeNull();
    expect(parsed.speakerFilter).toBeNull();
    expect(parsed.freeText).toBe("title: speaker:");
    expect(parsed.mode).toBe("transcript_hybrid");
  });
});

describe("buildNormalizedQuery", () => {
  test("prefers freeText when present", () => {
    const parsed = parseSearchQuery("hello speaker:jacob");
    expect(buildNormalizedQuery(parsed)).toBe("hello");
  });

  test("falls back to scoped values when freeText is empty", () => {
    const parsed = parseSearchQuery("title:china description:iran speaker:jacob");
    expect(buildNormalizedQuery(parsed)).toBe("china iran jacob");
  });
});
