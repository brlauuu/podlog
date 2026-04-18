/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/pipeline/queue/[episodeId]/retry/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function call(episodeId: string) {
  const req = new NextRequest(
    `http://localhost/api/pipeline/queue/${episodeId}/retry`,
    { method: "POST" }
  );
  return POST(req, { params: Promise.resolve({ episodeId }) });
}

describe("POST /api/pipeline/queue/[episodeId]/retry", () => {
  it("forwards retry request to pipeline and mirrors status + body", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ queued: true, episode_id: "ep-1" }),
    });

    const resp = await call("ep-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/queue/ep-1/retry",
      { method: "POST" }
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ queued: true, episode_id: "ep-1" });
  });

  it("mirrors non-200 status from upstream", async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      json: async () => ({ error: "not found" }),
    });

    const resp = await call("missing");

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ error: "not found" });
  });
});
