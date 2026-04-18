/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/feeds/[id]/poll/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function call(id: string) {
  const req = new NextRequest(`http://localhost/api/feeds/${id}/poll`, {
    method: "POST",
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe("POST /api/feeds/[id]/poll", () => {
  it("proxies poll request and mirrors upstream status + body", async () => {
    mockFetch.mockResolvedValue({
      status: 202,
      json: async () => ({ queued_episodes: 3 }),
    });

    const resp = await call("feed-abc");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/feed-abc/poll",
      { method: "POST" }
    );
    expect(resp.status).toBe(202);
    expect(await resp.json()).toEqual({ queued_episodes: 3 });
  });

  it("mirrors error status from pipeline", async () => {
    mockFetch.mockResolvedValue({
      status: 500,
      json: async () => ({ detail: "RSS parse error" }),
    });

    const resp = await call("feed-bad");

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ detail: "RSS parse error" });
  });
});
