/**
 * Tests for @/lib/search/grouped — searchGrouped() end-to-end shape,
 * covering both the FTS path and the metadata-only path.
 *
 * @jest-environment node
 */
const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: mockQuery } }));

jest.mock("@/lib/search/coverage", () => ({
  buildCoverage: jest.fn().mockResolvedValue(null),
  toCoverage: jest.fn(() => ({
    totalFeedsIndexed: 0,
    totalEpisodesIndexed: 0,
    indexedSpeakerCount: 0,
    totalSegments: 0,
  })),
}));

type GroupedModule = typeof import("@/lib/search/grouped");
let searchGrouped: GroupedModule["searchGrouped"];

beforeAll(async () => {
  const mod: GroupedModule = await import("@/lib/search/grouped");
  searchGrouped = mod.searchGrouped;
});

beforeEach(() => {
  mockQuery.mockReset();
});

function row(overrides: Record<string, unknown> = {}) {
  return {
    feed_id: "f1",
    feed_title: "F1",
    feed_mode: "full",
    episode_id: "ep-1",
    episode_title: "Ep 1",
    audio_url: null,
    audio_local_path: null,
    episode_url: null,
    mention_count: 1,
    best_rank: 0.5,
    ...overrides,
  };
}

describe("searchGrouped — metadata_only path", () => {
  it("runs metadata SQL when query has only scoped filters and no free text", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [row({ episode_title: "T1" }), row({ episode_id: "ep-2" })] })
      .mockResolvedValueOnce({
        rows: [{ total_episodes: 2, total_feeds: 1, total_mentions: 2, has_manual: false }],
      });

    const result = await searchGrouped("title:foo", null, true, 1, 20);

    expect(result.totalEpisodes).toBe(2);
    expect(result.totalFeeds).toBe(1);
    expect(result.totalMentions).toBe(2);
    expect(result.feeds).toHaveLength(1);
    expect(result.feeds[0].episodes).toHaveLength(2);

    const [rowsSql] = mockQuery.mock.calls[0];
    expect(rowsSql).toMatch(/FROM episodes e/);
    expect(rowsSql).not.toMatch(/speaker_turns/);
  });

  it("bumps totalFeeds by 1 when manual uploads are present", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [row({ feed_id: null, feed_title: "Manual episode" })] })
      .mockResolvedValueOnce({
        rows: [{ total_episodes: 1, total_feeds: 0, total_mentions: 1, has_manual: true }],
      });

    const result = await searchGrouped("title:foo", null, true, 1, 20);

    expect(result.totalFeeds).toBe(1);
  });

  it("skipCount=true means no count query is issued", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] });

    const result = await searchGrouped("title:foo", null, true, 1, 20, true);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result.totalEpisodes).toBe(-1);
    expect(result.totalMentions).toBe(-1);
  });
});

describe("searchGrouped — FTS path", () => {
  it("uses the speaker_turns CTE when query has free text", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [row({ mention_count: 3, best_rank: 0.9 })] })
      .mockResolvedValueOnce({
        rows: [{ total_episodes: 1, total_feeds: 1, total_mentions: 3, has_manual: false }],
      });

    const result = await searchGrouped("climate", null, true, 1, 20);

    const [rowsSql, rowsParams] = mockQuery.mock.calls[0];
    expect(rowsSql).toMatch(/WITH.*speaker_turns/s);
    expect(rowsParams[0]).toBe("climate");
    expect(result.feeds[0].episodes[0].mentionCount).toBe(3);
  });

  it("passes feedIds and pageSize/offset into the rows query", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [{ total_episodes: 0, total_feeds: 0, total_mentions: 0, has_manual: false }],
      });

    await searchGrouped("climate", ["feed-A", "feed-B"], false, 2, 10);

    const [, rowsParams] = mockQuery.mock.calls[0];
    expect(rowsParams[rowsParams.length - 2]).toBe(10);
    expect(rowsParams[rowsParams.length - 1]).toBe(10);
    // feedIds are bound as a single array param (f.id = ANY($N::uuid[])).
    expect(rowsParams).toEqual(
      expect.arrayContaining([["feed-A", "feed-B"]])
    );
  });

  it("returns -1 sentinels on counts when skipCount=true in FTS mode", async () => {
    mockQuery.mockResolvedValueOnce({ rows: [row()] });

    const result = await searchGrouped("climate", null, true, 1, 20, true);

    expect(mockQuery).toHaveBeenCalledTimes(1);
    expect(result.totalEpisodes).toBe(-1);
  });
});
