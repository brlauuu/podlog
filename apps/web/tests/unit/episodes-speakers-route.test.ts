/**
 * @jest-environment node
 */
const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: mockQuery } }));

import { NextRequest } from "next/server";

type RouteModule = typeof import("@/app/api/episodes/[id]/speakers/route");
let PUT: RouteModule["PUT"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/episodes/[id]/speakers/route");
  PUT = mod.PUT;
});

beforeEach(() => {
  mockQuery.mockReset();
});

function call(id: string, body: unknown) {
  const req = new NextRequest(`http://localhost/api/episodes/${id}/speakers`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return PUT(req, { params: Promise.resolve({ id }) });
}

describe("PUT /api/episodes/[id]/speakers", () => {
  it("upserts the display name with inferred=false and confirmed_by_user=true", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    const resp = await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Alice",
    });

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });

    const [sql, params] = mockQuery.mock.calls[0];
    expect(sql).toContain("INSERT INTO speaker_names");
    expect(sql).toContain("ON CONFLICT");
    expect(sql).toContain("inferred = false");
    expect(sql).toContain("confirmed_by_user = true");
    expect(params).toEqual(["ep-1", "SPEAKER_00", "Alice"]);
  });

  it("trims whitespace from display_name before persisting", async () => {
    mockQuery.mockResolvedValue({ rowCount: 1 });

    await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "   Alice   ",
    });

    const [, params] = mockQuery.mock.calls[0];
    expect(params[2]).toBe("Alice");
  });

  it("returns 400 when speaker_label is missing", async () => {
    const resp = await call("ep-1", { display_name: "Alice" });

    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({
      error: "speaker_label and display_name are required",
    });
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 400 when display_name is blank whitespace", async () => {
    const resp = await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "   ",
    });

    expect(resp.status).toBe(400);
    expect(mockQuery).not.toHaveBeenCalled();
  });

  it("returns 500 when DB query throws", async () => {
    mockQuery.mockRejectedValue(new Error("constraint violation"));
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const resp = await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Alice",
    });

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to update speaker name" });
    consoleErrorSpy.mockRestore();
  });
});
