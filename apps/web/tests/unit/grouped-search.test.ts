/**
 * Unit tests for grouped search API route parameter validation.
 *
 * These test the route handler logic without a live database by mocking
 * the search functions.
 *
 * @jest-environment node
 */

// Mock the search module before importing routes
jest.mock("@/lib/search", () => ({
  searchGrouped: jest.fn(),
  searchMentions: jest.fn(),
}));

import { NextRequest } from "next/server";

describe("GET /api/search/grouped", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let searchGrouped: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import("@/app/api/search/grouped/route");
    GET = mod.GET;
    const searchMod = await import("@/lib/search");
    searchGrouped = searchMod.searchGrouped as jest.Mock;
  });

  test("returns 400 when q is missing", async () => {
    const req = new NextRequest("http://localhost/api/search/grouped");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("q is required");
  });

  test("returns 400 when q is empty", async () => {
    const req = new NextRequest("http://localhost/api/search/grouped?q=   ");
    const resp = await GET(req);
    expect(resp.status).toBe(400);
  });

  test("calls searchGrouped with correct params", async () => {
    const mockResult = {
      feeds: [],
      totalFeeds: 0,
      totalEpisodes: 0,
      totalMentions: 0,
    };
    searchGrouped.mockResolvedValue(mockResult);

    const req = new NextRequest(
      "http://localhost/api/search/grouped?q=tariffs&page=2&pageSize=10"
    );
    const resp = await GET(req);
    expect(resp.status).toBe(200);
    expect(searchGrouped).toHaveBeenCalledWith("tariffs", null, 2, 10, false);
  });

  test("passes feedId filter when provided", async () => {
    searchGrouped.mockResolvedValue({
      feeds: [],
      totalFeeds: 0,
      totalEpisodes: 0,
      totalMentions: 0,
    });

    const feedId = "abc-123";
    const req = new NextRequest(
      `http://localhost/api/search/grouped?q=test&feedId=${feedId}`
    );
    await GET(req);
    expect(searchGrouped).toHaveBeenCalledWith("test", [feedId], 1, 20, false);
  });

  test("clamps pageSize to max 50", async () => {
    searchGrouped.mockResolvedValue({
      feeds: [],
      totalFeeds: 0,
      totalEpisodes: 0,
      totalMentions: 0,
    });

    const req = new NextRequest(
      "http://localhost/api/search/grouped?q=test&pageSize=100"
    );
    await GET(req);
    expect(searchGrouped).toHaveBeenCalledWith("test", null, 1, 50, false);
  });

  test("returns 500 on search error", async () => {
    searchGrouped.mockRejectedValue(new Error("DB down"));

    const req = new NextRequest(
      "http://localhost/api/search/grouped?q=test"
    );
    const resp = await GET(req);
    expect(resp.status).toBe(500);
  });
});

describe("GET /api/search/mentions", () => {
  let GET: (req: NextRequest) => Promise<Response>;
  let searchMentions: jest.Mock;

  beforeEach(async () => {
    jest.resetModules();
    const mod = await import("@/app/api/search/mentions/route");
    GET = mod.GET;
    const searchMod = await import("@/lib/search");
    searchMentions = searchMod.searchMentions as jest.Mock;
  });

  test("returns 400 when q is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/search/mentions?episodeId=ep-1"
    );
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("q is required");
  });

  test("returns 400 when episodeId is missing", async () => {
    const req = new NextRequest(
      "http://localhost/api/search/mentions?q=tariffs"
    );
    const resp = await GET(req);
    expect(resp.status).toBe(400);
    const body = await resp.json();
    expect(body.error).toBe("episodeId is required");
  });

  test("calls searchMentions with correct params", async () => {
    const mockResult = {
      episodeId: "ep-1",
      mentions: [
        {
          id: 1,
          startTime: 10.0,
          endTime: 15.0,
          speakerLabel: "SPEAKER_00",
          speakerDisplay: "Alice",
          snippet: "about <b>tariffs</b>",
          rank: 0.5,
        },
      ],
    };
    searchMentions.mockResolvedValue(mockResult);

    const req = new NextRequest(
      "http://localhost/api/search/mentions?q=tariffs&episodeId=ep-1"
    );
    const resp = await GET(req);
    expect(resp.status).toBe(200);
    expect(searchMentions).toHaveBeenCalledWith("tariffs", "ep-1");

    const body = await resp.json();
    expect(body.episodeId).toBe("ep-1");
    expect(body.mentions).toHaveLength(1);
    expect(body.mentions[0].snippet).toContain("<b>tariffs</b>");
  });

  test("returns 500 on search error", async () => {
    searchMentions.mockRejectedValue(new Error("DB down"));

    const req = new NextRequest(
      "http://localhost/api/search/mentions?q=test&episodeId=ep-1"
    );
    const resp = await GET(req);
    expect(resp.status).toBe(500);
  });
});
