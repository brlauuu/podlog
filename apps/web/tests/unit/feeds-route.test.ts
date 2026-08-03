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

describe("/api/feeds route — error and non-JSON paths", () => {
  it("GET wraps a non-JSON upstream body in { detail }", async () => {
    mockFetch.mockResolvedValue({ status: 502, text: async () => "upstream boom" });

    const resp = await GET();

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ detail: "upstream boom" });
  });

  it("GET returns 500 when the fetch throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("network down"));

    const resp = await GET();

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to load feeds" });
  });

  it("POST falls back to a detail message on an empty non-JSON body", async () => {
    mockFetch.mockResolvedValue({ status: 500, text: async () => "" });
    const req = new NextRequest("http://localhost/api/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "x" }),
    });

    const resp = await POST(req);

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ detail: "Pipeline API returned a non-JSON error" });
  });

  it("POST returns 500 when the fetch throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("network down"));
    const req = new NextRequest("http://localhost/api/feeds", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "x" }),
    });

    const resp = await POST(req);

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to add feed" });
  });
});
