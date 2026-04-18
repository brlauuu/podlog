/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/pipeline/embed/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

beforeEach(() => {
  mockFetch.mockReset();
  consoleErrorSpy.mockClear();
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

function makeReq(body: unknown) {
  return new NextRequest("http://localhost/api/pipeline/embed", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/pipeline/embed", () => {
  it("forwards body to pipeline and returns embedding on success", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ embedding: [0.1, 0.2, 0.3] }),
    });

    const resp = await POST(makeReq({ text: "hello" }));

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/embed",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: "hello" }),
      })
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ embedding: [0.1, 0.2, 0.3] });
  });

  it("propagates upstream status and returns error JSON when pipeline fails", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({}),
    });

    const resp = await POST(makeReq({ text: "x" }));

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Embedding failed" });
  });

  it("returns 503 when fetch throws", async () => {
    mockFetch.mockRejectedValue(new Error("ECONNREFUSED"));

    const resp = await POST(makeReq({ text: "x" }));

    expect(resp.status).toBe(503);
    expect(await resp.json()).toEqual({ error: "Embedding service unavailable" });
    expect(consoleErrorSpy).toHaveBeenCalled();
  });
});
