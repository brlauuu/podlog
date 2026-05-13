/**
 * Tests for GET /api/backups — thin proxy to the pipeline FastAPI.
 *
 * The route forwards the upstream JSON on success, preserves non-200
 * upstream status codes (with a safe fallback body so the UI never
 * blanks out on a transient pipeline hiccup), and degrades network
 * failures to a 502 with the same fallback shape (#666).
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import("@/app/api/backups/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/backups/route");
  GET = mod.GET;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/backups", () => {
  it("forwards the pipeline response verbatim on success", async () => {
    const payload = {
      enabled: true,
      mounted: true,
      retention: { daily: 7, weekly: 4, monthly: 12 },
      last_run: "2026-05-13T01:00:00Z",
      db: { daily: ["2026-05-13.dump"], weekly: [], monthly: [] },
      audio: [{ date: "2026-05-13", size_bytes: 12345 }],
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
      "http://pipeline:8000/api/backups",
      { cache: "no-store" },
    );
  });

  it("surfaces a non-200 upstream status with the fallback body", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({ detail: "upstream broken" }),
    });

    const resp = await GET();

    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.enabled).toBe(false);
    expect(body.db).toEqual({ daily: [], weekly: [], monthly: [] });
    expect(body.audio).toEqual([]);
    expect(body.retention).toEqual({ daily: 0, weekly: 0, monthly: 0 });
  });

  it("degrades a network failure to 502 with the fallback body", async () => {
    mockFetch.mockRejectedValue(new TypeError("connect ECONNREFUSED"));

    const resp = await GET();

    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.enabled).toBe(false);
    expect(body.mounted).toBe(false);
    expect(body.last_run).toBeNull();
  });
});
