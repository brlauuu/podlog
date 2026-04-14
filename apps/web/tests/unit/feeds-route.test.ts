/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/feeds/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({
  PIPELINE_API: "http://pipeline:8000",
}));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("/api/feeds route", () => {
  it("GET proxies feed list to pipeline API", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify([{ id: "feed-1", title: "Feed", episode_count: 2 }]),
    });

    const resp = await GET();
    const data = await resp.json();

    expect(mockFetch).toHaveBeenCalledWith("http://pipeline:8000/api/feeds");
    expect(resp.status).toBe(200);
    expect(data).toEqual([{ id: "feed-1", title: "Feed", episode_count: 2 }]);
  });

  it("POST continues proxying feed creation to pipeline API", async () => {
    mockFetch.mockResolvedValue({
      status: 201,
      text: async () => JSON.stringify({ id: "feed-1" }),
    });

    const req = new NextRequest("http://localhost/api/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    });

    const resp = await POST(req);
    const data = await resp.json();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
      })
    );
    expect(resp.status).toBe(201);
    expect(data).toEqual({ id: "feed-1" });
  });
});
