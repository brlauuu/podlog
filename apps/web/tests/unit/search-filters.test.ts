/**
 * @jest-environment node
 */
import {
  buildSpeakerTurnFilters,
  buildSegmentFilters,
  buildMetadataFilters,
  appendFilterSql,
  buildLikePattern,
} from "@/lib/search/filters";

const allOpts = {
  speakerLabel: "Alice",
  speakerLike: "ali",
  titleFilter: "news",
  descriptionFilter: "weekly",
};
const noOpts = {
  speakerLabel: null,
  speakerLike: null,
  titleFilter: null,
  descriptionFilter: null,
};

describe("buildLikePattern", () => {
  it("returns null for empty input", () => {
    expect(buildLikePattern(null)).toBeNull();
    expect(buildLikePattern("")).toBeNull();
  });

  it("wraps a value in %…%", () => {
    expect(buildLikePattern("news")).toBe("%news%");
  });
});

describe("buildSpeakerTurnFilters", () => {
  it("builds all four clauses with the 't' alias and sequential params", () => {
    const res = buildSpeakerTurnFilters(allOpts, 1);

    expect(res.clauses).toHaveLength(4);
    expect(res.clauses[0]).toContain("sn.display_name = $1");
    expect(res.clauses[1]).toContain("t.speaker_label ILIKE $2");
    expect(res.clauses[2]).toContain("e.title, '') ILIKE $3");
    expect(res.clauses[3]).toContain("e.description, '') ILIKE $4");
    expect(res.params).toEqual(["Alice", "ali", "%news%", "%weekly%"]);
    expect(res.nextIdx).toBe(5);
  });

  it("returns no clauses when all options are null", () => {
    const res = buildSpeakerTurnFilters(noOpts, 3);

    expect(res.clauses).toEqual([]);
    expect(res.params).toEqual([]);
    expect(res.nextIdx).toBe(3);
  });
});

describe("buildSegmentFilters", () => {
  it("uses the 's' alias for the speaker-like clause", () => {
    const res = buildSegmentFilters({ ...noOpts, speakerLike: "bob" }, 1);

    expect(res.clauses[0]).toContain("s.speaker_label ILIKE $1");
    expect(res.params).toEqual(["bob"]);
    expect(res.nextIdx).toBe(2);
  });
});

describe("buildMetadataFilters", () => {
  it("builds EXISTS clauses in title/description/speakerLike/speakerLabel order", () => {
    const res = buildMetadataFilters(allOpts, 1);

    expect(res.clauses).toHaveLength(4);
    expect(res.clauses[0]).toContain("e.title, '') ILIKE $1");
    expect(res.clauses[1]).toContain("e.description, '') ILIKE $2");
    expect(res.clauses[2]).toContain("FROM speaker_names sn");
    expect(res.clauses[2]).toContain("ILIKE $3");
    expect(res.clauses[3]).toContain("sn.confirmed_by_user = true");
    expect(res.clauses[3]).toContain("sn.display_name = $4");
    expect(res.params).toEqual(["%news%", "%weekly%", "ali", "Alice"]);
    expect(res.nextIdx).toBe(5);
  });

  it("returns no clauses when all options are null", () => {
    const res = buildMetadataFilters(noOpts, 1);

    expect(res.clauses).toEqual([]);
    expect(res.nextIdx).toBe(1);
  });
});

describe("appendFilterSql", () => {
  it("returns an empty string when there are no clauses", () => {
    expect(appendFilterSql([])).toBe("");
  });

  it("joins clauses with AND and a leading AND", () => {
    expect(appendFilterSql(["a = $1", "b = $2"])).toBe("AND a = $1 AND b = $2");
  });
});
