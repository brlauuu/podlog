/**
 * Unit tests for flat search API route parameter validation.
 *
 * These test the route handler logic without a live database by mocking
 * the search functions.
 *
 * @jest-environment node
 */

jest.mock("@/lib/search", () => ({
  searchSegments: jest.fn(),
}));

import { NextRequest } from "next/server";

const mockResult = {
  results: [],
  total: 0,
  page: 1,
  pageSize: 20,
  coverage: { processed: 0, total: 0 },
};

describe("GET /api/search", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let searchSegments: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import("@/app/api/search/route");
    GET = mod.GET;
    const searchMod = await import("@/lib/search");
    searchSegments = searchMod.searchSegments as jest.Mock;
  });

  test("returns 400 when q is missing", async () => {
    const req = new NextRequest("http://localhost/api/search");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  test("calls searchSegments with default params", async () => {
    searchSegments.mockResolvedValue(mockResult);
    const req = new NextRequest("http://localhost/api/search?q=test");
    await GET(req);
    expect(searchSegments).toHaveBeenCalledWith("test", null, false, 1, 20, false, null);
  });

  test("passes single feedId as array", async () => {
    searchSegments.mockResolvedValue(mockResult);
    const req = new NextRequest("http://localhost/api/search?q=test&feedId=abc-123");
    await GET(req);
    expect(searchSegments).toHaveBeenCalledWith("test", ["abc-123"], false, 1, 20, false, null);
  });

  test("parses comma-separated feedId into array", async () => {
    searchSegments.mockResolvedValue(mockResult);
    const req = new NextRequest("http://localhost/api/search?q=test&feedId=id-1,id-2,id-3");
    await GET(req);
    expect(searchSegments).toHaveBeenCalledWith(
      "test", ["id-1", "id-2", "id-3"], false, 1, 20, false, null
    );
  });

  test("passes includeManualUploads when uploads=true", async () => {
    searchSegments.mockResolvedValue(mockResult);
    const req = new NextRequest("http://localhost/api/search?q=test&uploads=true");
    await GET(req);
    expect(searchSegments).toHaveBeenCalledWith("test", null, true, 1, 20, false, null);
  });

  test("passes both feedIds and uploads together", async () => {
    searchSegments.mockResolvedValue(mockResult);
    const req = new NextRequest("http://localhost/api/search?q=test&feedId=id-1&uploads=true");
    await GET(req);
    expect(searchSegments).toHaveBeenCalledWith("test", ["id-1"], true, 1, 20, false, null);
  });

  test("clamps pageSize to max 50", async () => {
    searchSegments.mockResolvedValue(mockResult);
    const req = new NextRequest("http://localhost/api/search?q=test&pageSize=100");
    await GET(req);
    expect(searchSegments).toHaveBeenCalledWith("test", null, false, 1, 50, false, null);
  });

  test("returns 500 on search error", async () => {
    searchSegments.mockRejectedValue(new Error("DB down"));
    const req = new NextRequest("http://localhost/api/search?q=test");
    const resp = await GET(req);
    expect(resp.status).toBe(500);
  });
});
