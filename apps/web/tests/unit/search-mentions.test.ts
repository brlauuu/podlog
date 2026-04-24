/**
 * Tests for @/lib/search/mentions — searchMentions() context builder.
 *
 * @jest-environment node
 */
const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: mockQuery } }));

type MentionsModule = typeof import("@/lib/search/mentions");
let searchMentions: MentionsModule["searchMentions"];

beforeAll(async () => {
  const mod: MentionsModule = await import("@/lib/search/mentions");
  searchMentions = mod.searchMentions;
});

beforeEach(() => {
  mockQuery.mockReset();
});

function turn(
  id: string,
  text: string,
  isMatch: boolean,
  start = 0,
  end = 5,
  label = "SPEAKER_00",
  display = "SPEAKER_00"
) {
  return {
    id,
    start_time: String(start),
    end_time: String(end),
    speaker_label: label,
    speaker_display: display,
    full_text: text,
    is_match: isMatch,
    snippet: isMatch ? `<b>${text}</b>` : "",
    rank: isMatch ? "0.5" : "0",
  };
}

describe("searchMentions", () => {
  it("returns empty list when query is blank after parsing", async () => {
    const result = await searchMentions("   ", "ep-1");
    expect(result).toEqual({ episodeId: "ep-1", mentions: [] });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("builds mentions with up to 2 surrounding non-match context segments each side", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        turn("1", "before-2", false, 0, 1),
        turn("2", "before-1", false, 2, 3),
        turn("3", "the match here", true, 4, 5),
        turn("4", "after-1", false, 6, 7),
        turn("5", "after-2", false, 8, 9),
        turn("6", "after-3", false, 10, 11),
      ],
    });

    const result = await searchMentions("match", "ep-1");

    expect(result.episodeId).toBe("ep-1");
    expect(result.mentions).toHaveLength(1);
    const m = result.mentions[0];
    expect(m.id).toBe("3");
    expect(m.startTime).toBe(4);
    expect(m.contextBefore.map((c) => c.text)).toEqual(["before-2", "before-1"]);
    expect(m.contextAfter.map((c) => c.text)).toEqual(["after-1", "after-2"]);
  });

  it("stops context collection when another match is encountered", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        turn("1", "before-match", false, 0, 1),
        turn("2", "match A", true, 2, 3),
        turn("3", "between", false, 4, 5),
        turn("4", "match B", true, 6, 7),
      ],
    });

    const result = await searchMentions("match", "ep-1");

    expect(result.mentions).toHaveLength(2);
    const [a, b] = result.mentions;
    expect(a.contextAfter.map((c) => c.text)).toEqual(["between"]);
    expect(b.contextBefore.map((c) => c.text)).toEqual(["between"]);
  });

  it("appends speaker filter to SQL when speaker scope present", async () => {
    mockQuery.mockResolvedValue({ rows: [turn("1", "m", true)] });

    // Free text first, then scoped — otherwise the parser eats everything
    // after `speaker:` as the filter value (see queryParser.ts).
    await searchMentions("match speaker:Alice", "ep-1");

    const [, params] = mockQuery.mock.calls[0];
    expect(params).toEqual(["match", "ep-1", "%Alice%"]);
  });

  it("returns empty mentions when no rows are matches", async () => {
    mockQuery.mockResolvedValue({
      rows: [
        turn("1", "no match", false),
        turn("2", "also not", false),
      ],
    });

    const result = await searchMentions("term", "ep-1");
    expect(result.mentions).toEqual([]);
  });
});
