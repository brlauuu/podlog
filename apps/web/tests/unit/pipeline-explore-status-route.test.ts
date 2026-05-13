/**
 * Tests for GET /api/pipeline/explore/status — thin proxy to the
 * pipeline FastAPI's /api/explore/status endpoint (#668).
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import("@/app/api/pipeline/explore/status/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  GET = (await import("@/app/api/pipeline/explore/status/route")).GET;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/pipeline/explore/status", () => {
  it("forwards the upstream response shape on 200", async () => {
    const payload = {
      running: true,
      url: "http://localhost:8888/?token=abc",
      started_at: "2026-05-13T01:00:00Z",
    };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(payload);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/explore/status",
    );
  });

  it("forwards the not-running shape (running: false)", async () => {
    const payload = { running: false, url: null, started_at: null };
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(payload),
    });

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(payload);
  });

  it("forwards a non-200 upstream status verbatim", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ detail: "pipeline unreachable" }),
    });

    const resp = await GET();

    expect(resp.status).toBe(503);
    expect(await resp.json()).toEqual({ detail: "pipeline unreachable" });
  });
});
