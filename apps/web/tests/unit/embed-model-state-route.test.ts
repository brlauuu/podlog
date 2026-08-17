/**
 * @jest-environment node
 */
import { GET } from "@/app/api/pipeline/embed-model-state/route";

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/pipeline/embed-model-state (#945)", () => {
  it("proxies the provenance record from the pipeline", async () => {
    const body = {
      recorded_model: "BAAI/bge-small-en-v1.5",
      configured_model: "BAAI/bge-small-en-v1.5",
      matches: true,
      embedded_segments: 10,
    };
    mockFetch.mockResolvedValue({ ok: true, json: async () => body });

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(body);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/embed/model-state",
      expect.objectContaining({ cache: "no-store" })
    );
  });

  it("bounds the upstream call so a hung pipeline cannot stall Settings", async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });

    await GET();

    expect(mockFetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });

  it("returns 502 when the pipeline responds non-ok", async () => {
    mockFetch.mockResolvedValue({ ok: false, json: async () => ({}) });

    expect((await GET()).status).toBe(502);
  });

  it("returns 502 rather than throwing when the pipeline is unreachable", async () => {
    mockFetch.mockRejectedValue(new Error("EAI_AGAIN"));

    expect((await GET()).status).toBe(502);
  });
});
