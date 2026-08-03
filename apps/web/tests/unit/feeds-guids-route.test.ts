/**
 * @jest-environment node
 */
import { GET } from "@/app/api/feeds/[id]/episodes/guids/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

function call(id: string) {
  return GET(new Request(`http://localhost/api/feeds/${id}/episodes/guids`), {
    params: Promise.resolve({ id }),
  });
}

describe("GET /api/feeds/[id]/episodes/guids", () => {
  it("proxies the GUID list from the pipeline API", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      text: async () => JSON.stringify({ guids: ["a", "b"] }),
    });

    const resp = await call("feed-1");

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/feeds/feed-1/episodes/guids"
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ guids: ["a", "b"] });
  });

  it("wraps a non-JSON upstream body in { detail }", async () => {
    mockFetch.mockResolvedValue({ status: 502, text: async () => "gateway boom" });

    const resp = await call("feed-1");

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ detail: "gateway boom" });
  });

  it("returns 500 when the fetch throws", async () => {
    jest.spyOn(console, "error").mockImplementation(() => {});
    mockFetch.mockRejectedValue(new Error("network down"));

    const resp = await call("feed-1");

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to load feed episodes" });
  });
});
