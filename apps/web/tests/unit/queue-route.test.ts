/**
 * Tests for GET /api/queue — thin proxy to the pipeline FastAPI.
 *
 * Ownership of the queue-dashboard read moved to the pipeline side
 * (#555); the web route now just forwards, normalizes empty bodies,
 * and degrades transient failures to a 502.
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import("@/app/api/queue/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/queue/route");
  GET = mod.GET;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/queue", () => {
  it("forwards the pipeline response verbatim on success", async () => {
    const payload = {
      active_count: 1,
      pending_count: 2,
      failed_count: 0,
      done_count: 99,
      stuck_count: 0,
      active_jobs: [{ episode_id: "ep-1", status: "transcribing" }],
      pending_jobs: [
        { episode_id: "ep-2", status: "pending" },
        { episode_id: "ep-3", status: "pending" },
      ],
      failed_jobs: [],
      done_jobs: [],
      stuck_jobs: [],
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify(payload)),
    });

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/queue",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("returns null body when upstream returns empty text", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });

    const resp = await GET();
    expect(await resp.json()).toBeNull();
  });

  it("surfaces upstream non-2xx status through to the client", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve(JSON.stringify({ detail: "db down" })),
    });

    const resp = await GET();
    expect(resp.status).toBe(503);
    expect(await resp.json()).toEqual({ detail: "db down" });
  });

  it("returns 502 with hint when upstream body is non-JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      text: () => Promise.resolve("<html>upstream exploded</html>"),
    });

    const resp = await GET();
    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({
      error: "Upstream returned non-JSON (status 500)",
    });
  });

  it("returns 502 with fetch-error fallback when the pipeline is unreachable", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const resp = await GET();

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ error: "Failed to fetch queue" });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
