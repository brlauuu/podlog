/**
 * @jest-environment node
 */
import { GET } from "@/app/api/pipeline/health/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("GET /api/pipeline/health", () => {
  it("proxies pipeline health JSON on success", async () => {
    const payload = {
      status: "HEALTHY",
      services: [{ name: "Database", status: "HEALTHY" }],
    };
    mockFetch.mockResolvedValue({ json: async () => payload });

    const resp = await GET();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/health",
      { cache: "no-store" }
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual(payload);
  });

  it("returns full DEGRADED payload on fetch failure", async () => {
    mockFetch.mockRejectedValue(new Error("network"));

    const resp = await GET();

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data.status).toBe("DEGRADED");
    expect(data.services).toHaveLength(3);
    for (const svc of data.services) {
      expect(svc.status).toBe("DEGRADED");
    }
    expect(data.services.map((s: { name: string }) => s.name)).toEqual([
      "Pipeline API",
      "Database",
      "Worker",
    ]);
  });
});
