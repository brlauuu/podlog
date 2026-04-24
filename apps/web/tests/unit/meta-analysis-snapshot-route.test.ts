/**
 * Tests for GET /api/meta-analysis/snapshot — proxy to pipeline FastAPI.
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import("@/app/api/meta-analysis/snapshot/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/meta-analysis/snapshot/route");
  GET = mod.GET;
});

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResponse(body: unknown, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(JSON.stringify(body)),
  };
}

describe("GET /api/meta-analysis/snapshot", () => {
  it("proxies JSON response and status from upstream", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ snapshot: { x: 1 }, is_stale: false }));

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ snapshot: { x: 1 }, is_stale: false });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/meta-analysis/snapshot",
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

  it("returns 502 with error hint when upstream returns non-JSON", async () => {
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

  it("returns 502 'Pipeline unreachable' when fetch throws", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const resp = await GET();

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ error: "Pipeline unreachable" });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
