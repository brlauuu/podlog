/**
 * Tests for GET /api/meta-analysis/coverage/missing-speakers — proxy to
 * pipeline FastAPI. Transient failures degrade to `{podcasts: []}`.
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import(
  "@/app/api/meta-analysis/coverage/missing-speakers/route"
);
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import(
    "@/app/api/meta-analysis/coverage/missing-speakers/route"
  );
  GET = mod.GET;
});

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/meta-analysis/coverage/missing-speakers", () => {
  it("proxies upstream podcasts list", async () => {
    const podcasts = [{ feed_id: "f1", title: "T", episodes: [] }];
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(JSON.stringify({ podcasts })),
    });

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ podcasts });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/meta-analysis/coverage/missing-speakers",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("degrades to empty podcasts on non-JSON upstream response", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      text: () => Promise.resolve("<html>down</html>"),
    });

    const resp = await GET();

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ podcasts: [] });
  });

  it("degrades to empty podcasts when fetch throws", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("ETIMEDOUT"));

    const resp = await GET();

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ podcasts: [] });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });

  it("returns null body when upstream text is empty", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      text: () => Promise.resolve(""),
    });

    const resp = await GET();
    expect(await resp.json()).toBeNull();
  });
});
