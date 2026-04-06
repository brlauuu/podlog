/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/feeds/preview/route";

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
