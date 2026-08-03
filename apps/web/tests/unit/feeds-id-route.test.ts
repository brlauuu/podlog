/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { DELETE, PATCH } from "@/app/api/feeds/[id]/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function call(id: string, url: string) {
  const req = new NextRequest(url, { method: "DELETE" });
  return DELETE(req, { params: Promise.resolve({ id }) });
}

describe("DELETE /api/feeds/[id]", () => {
  it("returns empty 204 when pipeline returns 204", async () => {
    mockFetch.mockResolvedValue({ status: 204, json: async () => ({}) });

    const resp = await call("feed-1", "http://localhost/api/feeds/feed-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/feed-1?delete_episodes=false",
      { method: "DELETE" }
    );
    expect(resp.status).toBe(204);
    expect(await resp.text()).toBe("");
  });

  it("forwards delete_episodes=true when query param is set", async () => {
    mockFetch.mockResolvedValue({ status: 204, json: async () => ({}) });

    await call(
      "feed-1",
      "http://localhost/api/feeds/feed-1?delete_episodes=true"
    );

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/feed-1?delete_episodes=true",
      { method: "DELETE" }
    );
  });

  it("mirrors non-204 status and JSON body from upstream", async () => {
    mockFetch.mockResolvedValue({
      status: 409,
      json: async () => ({ detail: "Feed has running jobs" }),
    });

    const resp = await call("feed-1", "http://localhost/api/feeds/feed-1");

    expect(resp.status).toBe(409);
    expect(await resp.json()).toEqual({ detail: "Feed has running jobs" });
  });
});

function patch(id: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/feeds/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PATCH(req, { params: Promise.resolve({ id }) });
}

describe("PATCH /api/feeds/[id]", () => {
  it("forwards the { paused } body to the pipeline and mirrors the response", async () => {
    mockFetch.mockResolvedValue({ status: 200, json: async () => ({ id: "feed-1", paused: true }) });

    const resp = await patch("feed-1", { paused: true });

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/feed-1",
      expect.objectContaining({
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paused: true }),
      })
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ id: "feed-1", paused: true });
  });

  it("mirrors an upstream error status and body", async () => {
    mockFetch.mockResolvedValue({ status: 404, json: async () => ({ detail: "Feed not found" }) });

    const resp = await patch("missing", { paused: false });

    expect(resp.status).toBe(404);
    expect(await resp.json()).toEqual({ detail: "Feed not found" });
  });
});
