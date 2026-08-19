/**
 * @jest-environment node
 */
import { POST } from "@/app/api/pyannote/test/route";

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => mockFetch.mockReset());

function req(body: unknown) {
  return { json: async () => body } as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/pyannote/test (#933)", () => {
  it("proxies the key to the pipeline and returns its response", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200, json: async () => ({ ok: true }) });

    const resp = await POST(req({ api_key: "k" }));

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });
    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/pyannote/test",
      expect.objectContaining({ method: "POST" })
    );
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({ api_key: "k" });
  });

  it("preserves the upstream status so the UI can show the real reason", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({ error: "pyannote.ai rejected this key" }),
    });

    const resp = await POST(req({ api_key: "bad" }));

    expect(resp.status).toBe(502);
    expect((await resp.json()).error).toMatch(/rejected/);
  });

  it("preserves a 400 for the no-key-configured case", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({ error: "No pyannote API key to test." }),
    });

    expect((await POST(req({}))).status).toBe(400);
  });
});
