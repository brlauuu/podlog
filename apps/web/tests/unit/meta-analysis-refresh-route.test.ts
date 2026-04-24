/**
 * Tests for POST /api/meta-analysis/refresh — proxy to pipeline FastAPI.
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import("@/app/api/meta-analysis/refresh/route");
let POST: RouteModule["POST"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/meta-analysis/refresh/route");
  POST = mod.POST;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe("POST /api/meta-analysis/refresh", () => {
  it("forwards POST and returns upstream JSON with status", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ recomputed: true })),
    });

    const resp = await POST();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ recomputed: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/meta-analysis/refresh",
      expect.objectContaining({ method: "POST", cache: "no-store" })
    );
  });

  it("handles empty upstream body as null", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });

    const resp = await POST();
    expect(await resp.json()).toBeNull();
  });

  it("returns 502 with hint when upstream returns non-JSON", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      text: () => Promise.resolve("bad gateway html"),
    });

    const resp = await POST();

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({
      error: "Upstream returned non-JSON (status 502)",
    });
  });

  it("returns 502 'Refresh failed' when fetch throws", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("network down"));

    const resp = await POST();

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ error: "Refresh failed" });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
