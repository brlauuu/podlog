/**
 * Unit tests for GET /api/search/speakers
 *
 * Tests route handler logic without a live DB by mocking the pool.
 *
 * @jest-environment node
 */

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ query: mockQuery }));

import { NextRequest } from "next/server";

const mockRows = [
  { speaker_label: "SPEAKER_00", display_name: "Alice" },
  { speaker_label: "SPEAKER_01", display_name: "Bob" },
];

describe("GET /api/search/speakers", () => {
  let GET: (req: NextRequest) => Promise<Response>;

  beforeEach(async () => {
    jest.resetModules();
    mockQuery.mockReset();
    mockQuery.mockResolvedValue({ rows: mockRows });
    const mod = await import("@/app/api/search/speakers/route");
    GET = mod.GET;
  });

  test("returns speaker list with no feed filter", async () => {
    const req = new NextRequest("http://localhost/api/search/speakers");
    const resp = await GET(req);
    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toEqual(mockRows);
    // No feed params — WHERE clause should use TRUE
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("TRUE");
    expect(mockQuery.mock.calls[0][1]).toEqual([]);
  });

  test("passes feed UUID as array param when feedId provided", async () => {
    const req = new NextRequest(
      "http://localhost/api/search/speakers?feedId=abc-123"
    );
    await GET(req);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("ANY($1::uuid[])");
    expect(mockQuery.mock.calls[0][1]).toEqual([["abc-123"]]);
  });

  test("passes multiple feed UUIDs as array", async () => {
    const req = new NextRequest(
      "http://localhost/api/search/speakers?feedId=id-1,id-2,id-3"
    );
    await GET(req);
    expect(mockQuery.mock.calls[0][1]).toEqual([["id-1", "id-2", "id-3"]]);
  });

  test("includes uploads clause when uploads=true and no feedIds", async () => {
    const req = new NextRequest(
      "http://localhost/api/search/speakers?uploads=true"
    );
    await GET(req);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("feed_id IS NULL");
    expect(mockQuery.mock.calls[0][1]).toEqual([]);
  });

  test("combines feedId and uploads filters", async () => {
    const req = new NextRequest(
      "http://localhost/api/search/speakers?feedId=id-1&uploads=true"
    );
    await GET(req);
    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("ANY($1::uuid[])");
    expect(sql).toContain("feed_id IS NULL");
    expect(mockQuery.mock.calls[0][1]).toEqual([["id-1"]]);
  });

  test("returns 500 when DB throws", async () => {
    mockQuery.mockRejectedValue(new Error("DB down"));
    const req = new NextRequest("http://localhost/api/search/speakers");
    const resp = await GET(req);
    expect(resp.status).toBe(500);
  });
});
