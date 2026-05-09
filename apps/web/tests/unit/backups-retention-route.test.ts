/**
 * @jest-environment node
 */
import { GET, PUT } from "@/app/api/backups/retention/route";
import { NextRequest } from "next/server";

const mockFetch = jest.fn();
global.fetch = mockFetch as unknown as typeof fetch;

beforeEach(() => {
  mockFetch.mockReset();
});

function jsonResp(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe("/api/backups/retention proxy", () => {
  it("GET forwards body and status from the pipeline", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResp({ retention: { daily: 7, weekly: 4, monthly: 12 } }),
    );
    const resp = await GET();
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backups/retention"),
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({
      retention: { daily: 7, weekly: 4, monthly: 12 },
    });
  });

  it("PUT forwards JSON body to the pipeline", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResp({ retention: { daily: 1, weekly: 0, monthly: 0 } }),
    );
    const req = new NextRequest("http://localhost/api/backups/retention", {
      method: "PUT",
      body: JSON.stringify({ daily: 1, weekly: 0, monthly: 0 }),
      headers: { "Content-Type": "application/json" },
    });
    const resp = await PUT(req);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/backups/retention"),
      expect.objectContaining({
        method: "PUT",
        body: JSON.stringify({ daily: 1, weekly: 0, monthly: 0 }),
      }),
    );
    expect(resp.status).toBe(200);
  });

  it("PUT surfaces upstream 400 errors unchanged", async () => {
    mockFetch.mockReturnValueOnce(
      jsonResp({ detail: "daily=0 requires weekly=0 and monthly=0" }, 400),
    );
    const req = new NextRequest("http://localhost/api/backups/retention", {
      method: "PUT",
      body: JSON.stringify({ daily: 0, weekly: 4, monthly: 0 }),
    });
    const resp = await PUT(req);
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({
      detail: "daily=0 requires weekly=0 and monthly=0",
    });
  });
});
