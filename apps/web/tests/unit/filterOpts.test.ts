/**
 * Tests for @/lib/search/filterOpts — `buildMetadataSnippet` formatting.
 */
import { buildMetadataSnippet } from "@/lib/search/filterOpts";
import { parseSearchQuery } from "@/lib/search/queryParser";

describe("buildMetadataSnippet", () => {
  it("prefers a title match when titleFilter matches and episode_title present", () => {
    const parsed = parseSearchQuery("title:election");
    const snippet = buildMetadataSnippet(
      { episode_title: "Election 2026 Recap", episode_description: null },
      parsed
    );
    expect(snippet).toBe("Title match: Election 2026 Recap");
  });

  it("returns trimmed description for descriptionFilter matches", () => {
    const parsed = parseSearchQuery("description:climate");
    const snippet = buildMetadataSnippet(
      { episode_title: "T", episode_description: "  Long climate episode.  " },
      parsed
    );
    expect(snippet).toBe("Long climate episode.");
  });

  it("truncates long descriptions to 240 chars with ellipsis", () => {
    const parsed = parseSearchQuery("description:x");
    const longText = "a".repeat(500);
    const snippet = buildMetadataSnippet(
      { episode_title: null, episode_description: longText },
      parsed
    );
    expect(snippet).toHaveLength(240 + 3);
    expect(snippet.endsWith("...")).toBe(true);
  });

  it("returns speaker-match snippet when only speakerFilter is set", () => {
    const parsed = parseSearchQuery("speaker:Alice");
    const snippet = buildMetadataSnippet(
      { episode_title: null, episode_description: null },
      parsed
    );
    expect(snippet).toBe("Speaker match: Alice");
  });

  it("falls back to episode_title when no scoped filters", () => {
    const parsed = parseSearchQuery("free text");
    const snippet = buildMetadataSnippet(
      { episode_title: "My Episode", episode_description: null },
      parsed
    );
    expect(snippet).toBe("My Episode");
  });

  it("final fallback is 'Episode match' when everything is null", () => {
    const parsed = parseSearchQuery("free text");
    const snippet = buildMetadataSnippet(
      { episode_title: null, episode_description: null },
      parsed
    );
    expect(snippet).toBe("Episode match");
  });
});
