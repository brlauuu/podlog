/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { DELETE } from "@/app/api/feeds/[id]/route";

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
