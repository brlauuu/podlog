/**
 * @jest-environment node
 *
 * Issue #487: proxy routes for adding more episodes to a selective feed
 * and for listing already-ingested GUIDs.
 */
import { NextRequest } from "next/server";
import { POST as postEpisodes } from "@/app/api/feeds/[id]/episodes/route";
import { GET as getGuids } from "@/app/api/feeds/[id]/episodes/guids/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("POST /api/feeds/[id]/episodes", () => {
  it("proxies body to the pipeline and mirrors the 202 response", async () => {
    mockFetch.mockResolvedValue({
      status: 202,
      text: async () => JSON.stringify({ queued: 2, skipped: 1 }),
    });

    const req = new NextRequest("http://localhost/api/feeds/feed-1/episodes", {
      method: "POST",
      body: JSON.stringify({ selected_guids: ["a", "b", "c"] }),
      headers: { "Content-Type": "application/json" },
    });
    const resp = await postEpisodes(req, { params: Promise.resolve({ id: "feed-1" }) });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/feed-1/episodes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_guids: ["a", "b", "c"] }),
      },
    );
    expect(resp.status).toBe(202);
    expect(await resp.json()).toEqual({ queued: 2, skipped: 1 });
  });

  it("mirrors upstream 422 with structured detail", async () => {
    mockFetch.mockResolvedValue({
      status: 422,
      text: async () => JSON.stringify({ detail: "Only selective feeds..." }),
    });

    const req = new NextRequest("http://localhost/api/feeds/feed-1/episodes", {
      method: "POST",
      body: JSON.stringify({ selected_guids: ["a"] }),
      headers: { "Content-Type": "application/json" },
    });
    const resp = await postEpisodes(req, { params: Promise.resolve({ id: "feed-1" }) });

    expect(resp.status).toBe(422);
    expect(await resp.json()).toEqual({ detail: "Only selective feeds..." });
  });

  it("wraps non-JSON upstream errors as { detail: <text> }", async () => {
    mockFetch.mockResolvedValue({
      status: 500,
      text: async () => "Internal Server Error",
    });

    const req = new NextRequest("http://localhost/api/feeds/feed-1/episodes", {
      method: "POST",
      body: JSON.stringify({ selected_guids: ["a"] }),
      headers: { "Content-Type": "application/json" },
    });
    const resp = await postEpisodes(req, { params: Promise.resolve({ id: "feed-1" }) });

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ detail: "Internal Server Error" });
  });
});

describe("GET /api/feeds/[id]/episodes/guids", () => {
  it("returns the GUID list from the pipeline", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify(["ep-001", "ep-002"]),
    });

    const req = new Request("http://localhost/api/feeds/feed-1/episodes/guids");
    const resp = await getGuids(req, { params: Promise.resolve({ id: "feed-1" }) });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/feed-1/episodes/guids",
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(["ep-001", "ep-002"]);
  });

  it("mirrors 404 when the feed is unknown", async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      text: async () => JSON.stringify({ detail: "Feed not found" }),
    });

    const req = new Request("http://localhost/api/feeds/missing/episodes/guids");
    const resp = await getGuids(req, { params: Promise.resolve({ id: "missing" }) });

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ detail: "Feed not found" });
  });
});
