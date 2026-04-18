/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/episodes/[id]/retry/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function call(id: string) {
  const req = new NextRequest(`http://localhost/api/episodes/${id}/retry`, {
    method: "POST",
  });
  return POST(req, { params: Promise.resolve({ id }) });
}

describe("POST /api/episodes/[id]/retry", () => {
  it("forwards retry to pipeline queue endpoint and mirrors response", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ queued: true }),
    });

    const resp = await call("ep-xyz");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/queue/ep-xyz/retry",
      { method: "POST" }
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ queued: true });
  });

  it("mirrors 404 when episode not found upstream", async () => {
    mockFetch.mockResolvedValue({
      status: 404,
      json: async () => ({ detail: "episode not found" }),
    });

    const resp = await call("missing");

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ detail: "episode not found" });
  });
});
