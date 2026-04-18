/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/episodes/ingest/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/episodes/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/episodes/ingest", () => {
  it("forwards JSON body to pipeline and mirrors response", async () => {
    mockFetch.mockResolvedValue({
      status: 201,
      json: async () => ({ episode_id: "ep-1" }),
    });

    const resp = await POST(makeReq({ audio_url: "https://ex.com/a.mp3" }));

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/episodes/ingest",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ audio_url: "https://ex.com/a.mp3" }),
      })
    );
    expect(resp.status).toBe(201);
    expect(await resp.json()).toEqual({ episode_id: "ep-1" });
  });

  it("mirrors validation error from pipeline", async () => {
    mockFetch.mockResolvedValue({
      status: 422,
      json: async () => ({ detail: "audio_url is required" }),
    });

    const resp = await POST(makeReq({}));

    expect(resp.status).toBe(422);
    expect(await resp.json()).toEqual({ detail: "audio_url is required" });
  });
});
