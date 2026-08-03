/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { GET, POST } from "@/app/api/feeds/preview/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({
  PIPELINE_API: "http://pipeline:8000",
}));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("POST /api/feeds/preview", () => {
  it("returns 400 when url is missing", async () => {
    const req = new NextRequest("http://localhost/api/feeds/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    const resp = await POST(req);
    const data = await resp.json();

    expect(resp.status).toBe(400);
    expect(data).toEqual({ error: "url is required" });
  });

  it("proxies preview request to pipeline API", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ title: "Test Feed", episodes: [] }),
    });

    const req = new NextRequest("http://localhost/api/feeds/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/feed.xml" }),
    });

    const resp = await POST(req);
    const data = await resp.json();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/preview?url=https%3A%2F%2Fexample.com%2Ffeed.xml"
    );
    expect(resp.status).toBe(200);
    expect(data).toEqual({ title: "Test Feed", episodes: [] });
  });
});

describe("GET /api/feeds/preview", () => {
  it("returns 400 when the url query param is missing", async () => {
    const resp = await GET(new NextRequest("http://localhost/api/feeds/preview"));

    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: "url query parameter is required" });
  });

  it("proxies the url query param to the pipeline API", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ title: "Test Feed", episodes: [] }),
    });

    const resp = await GET(
      new NextRequest("http://localhost/api/feeds/preview?url=https://example.com/feed.xml")
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/preview?url=https%3A%2F%2Fexample.com%2Ffeed.xml"
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ title: "Test Feed", episodes: [] });
  });

  it("wraps a non-JSON upstream body in { detail }", async () => {
    mockFetch.mockResolvedValue({ status: 502, text: async () => "gateway boom" });

    const resp = await GET(
      new NextRequest("http://localhost/api/feeds/preview?url=https://example.com/feed.xml")
    );

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ detail: "gateway boom" });
  });

  it("returns 500 when the upstream fetch throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("network down"));

    const resp = await GET(
      new NextRequest("http://localhost/api/feeds/preview?url=https://example.com/feed.xml")
    );

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to fetch feed preview" });
  });
});

describe("POST /api/feeds/preview — malformed body", () => {
  it("returns 400 when the request body is not valid JSON", async () => {
    const req = new NextRequest("http://localhost/api/feeds/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not-json",
    });

    const resp = await POST(req);

    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: "url is required" });
  });
});
