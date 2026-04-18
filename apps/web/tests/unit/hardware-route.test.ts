/**
 * @jest-environment node
 */
import { GET } from "@/app/api/hardware/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/hardware", () => {
  it("proxies pipeline hardware info on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ hardware: { cpu: "x86_64" }, profile: "local" }),
    });

    const resp = await GET();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/hardware",
      { cache: "no-store" }
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({
      hardware: { cpu: "x86_64" },
      profile: "local",
    });
  });

  it("returns fallback with upstream status when pipeline returns non-OK", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 503,
      json: async () => ({}),
    });

    const resp = await GET();

    expect(resp.status).toBe(503);
    const body = await resp.json();
    expect(body.hardware).toBeNull();
    expect(body.profile).toBeNull();
    expect(body.estimates.remote_cost_per_hour_usd).toBe(0.36);
  });

  it("returns fallback with 502 when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const resp = await GET();

    expect(resp.status).toBe(502);
    const body = await resp.json();
    expect(body.hardware).toBeNull();
    expect(body.estimates.remote_transcription_minutes_per_hour).toBe(3);
  });
});
