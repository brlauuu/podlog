/**
 * Tests for GET /api/queue/recent — thin proxy to the pipeline (#1079).
 *
 * @jest-environment node
 */
const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

type RouteModule = typeof import("@/app/api/queue/recent/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/queue/recent/route");
  GET = mod.GET;
});

beforeEach(() => {
  mockFetch.mockReset();
});

function upstream(status: number, body: string) {
  mockFetch.mockResolvedValue({ ok: status < 400, status, text: () => Promise.resolve(body) });
}

describe("GET /api/queue/recent", () => {
  it("asks the pipeline for the last 7 days and forwards the rows", async () => {
    const rows = [{ episode_id: "ep-1", outcome: "done" }];
    upstream(200, JSON.stringify(rows));

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(rows);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/queue/recent?days=7",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("returns an empty list when upstream returns an empty body", async () => {
    upstream(200, "");
    expect(await (await GET()).json()).toEqual([]);
  });

  it("surfaces upstream non-2xx status", async () => {
    upstream(503, JSON.stringify({ detail: "db down" }));
    expect((await GET()).status).toBe(503);
  });

  it("returns 502 when upstream body is non-JSON", async () => {
    upstream(500, "<html>boom</html>");
    expect((await GET()).status).toBe(502);
  });

  it("returns 502 when the pipeline is unreachable", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));
    expect((await GET()).status).toBe(502);
  });
});
