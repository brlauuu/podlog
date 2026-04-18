/**
 * @jest-environment node
 */
import { NextRequest } from "next/server";
import { POST } from "@/app/api/notifications/test/route";

const mockFetch = jest.fn();
global.fetch = mockFetch;

jest.mock("@/lib/pipeline", () => ({ PIPELINE_API: "http://pipeline:8000" }));

beforeEach(() => {
  mockFetch.mockReset();
});

describe("POST /api/notifications/test", () => {
  it("forwards body to pipeline test endpoint and mirrors response", async () => {
    mockFetch.mockResolvedValue({
      status: 200,
      json: async () => ({ delivered: true }),
    });

    const req = new NextRequest("http://localhost/api/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "user@example.com" }),
    });

    const resp = await POST(req);

    expect(mockFetch).toHaveBeenCalledWith(
      "http://pipeline:8000/api/notifications/test",
      expect.objectContaining({
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user@example.com" }),
      })
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ delivered: true });
  });

  it("mirrors pipeline error status when SMTP fails", async () => {
    mockFetch.mockResolvedValue({
      status: 502,
      json: async () => ({ detail: "SMTP unreachable" }),
    });

    const req = new NextRequest("http://localhost/api/notifications/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const resp = await POST(req);

    expect(resp.status).toBe(502);
    expect(await resp.json()).toEqual({ detail: "SMTP unreachable" });
  });
});
