/**
 * @jest-environment node
 */

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: {
    query: jest.fn(),
  },
}));

jest.mock("@/lib/searchHybrid", () => ({
  mergeHybridSearchResults: jest.fn(() => ({ results: [], total: 0 })),
}));

import pool from "@/lib/db";
import { searchSegments } from "@/lib/search";

const mockQuery = (pool as unknown as { query: jest.Mock }).query;

describe("search.ts feed filtering", () => {
  beforeEach(() => {
    mockQuery.mockReset();
    global.fetch = jest.fn(async () => ({ ok: false, json: async () => ({}) } as Response));
  });

  test("uses TRUE filter when no feed IDs and uploads are excluded", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // fts
      .mockResolvedValueOnce({ rows: [{ count: "0" }] }) // count
      .mockResolvedValueOnce({ rows: [{ processed: 0, total: 0 }] }); // coverage

    await searchSegments("hello", null, false, 1, 20, false);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("AND TRUE");
    expect(params).toEqual(["hello", 100]);
  });

  test("includes feed UUID and manual uploads in SQL filter when both selected", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // fts
      .mockResolvedValueOnce({ rows: [{ count: "1" }] }) // count
      .mockResolvedValueOnce({ rows: [{ processed: 3, total: 5 }] }); // coverage

    await searchSegments("hello", ["feed-1"], true, 1, 20, false);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("f.id = ANY($2::uuid[])");
    expect(sql).toContain("e.feed_id IS NULL");
    expect(params).toEqual(["hello", ["feed-1"], 100]);
  });

  test("uses metadata-only episode query for title scoped search", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // metadata rows
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // metadata count
      .mockResolvedValueOnce({ rows: [{ processed: 0, total: 0 }] }); // coverage

    await searchSegments("title:iran", null, false, 1, 20, false);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM episodes e");
    expect(sql).not.toContain("FROM speaker_turns t");
    expect(params).toEqual(["%iran%", 20, 0]);
  });

  test("uses metadata-only episode query for description scoped search", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // metadata rows
      .mockResolvedValueOnce({ rows: [{ total: 0 }] }) // metadata count
      .mockResolvedValueOnce({ rows: [{ processed: 0, total: 0 }] }); // coverage

    await searchSegments("description:geopolitics", null, false, 1, 20, false);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("FROM episodes e");
    expect(sql).toContain("COALESCE(e.description, '') ILIKE");
    expect(sql).not.toContain("FROM speaker_turns t");
    expect(params).toEqual(["%geopolitics%", 20, 0]);
  });

  test("applies case-insensitive speaker scoped filter in transcript mode", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [] }) // fts
      .mockResolvedValueOnce({ rows: [{ count: "0" }] }) // count
      .mockResolvedValueOnce({ rows: [{ processed: 0, total: 0 }] }); // coverage

    await searchSegments("crisis in Iran speaker: jacob", null, false, 1, 20, false);

    const [sql, params] = mockQuery.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("ILIKE");
    expect(params).toEqual(["crisis in Iran", "%jacob%", 100]);
  });
});
