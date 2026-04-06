/**
 * @jest-environment node
 */
import { GET, PUT } from "@/app/api/wizard/status/route";
import { NextRequest } from "next/server";

// Mock the pg pool
const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

beforeEach(() => {
  mockQuery.mockReset();
});

describe("GET /api/wizard/status", () => {
  it("returns completed: false when key does not exist", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const resp = await GET();
    const data = await resp.json();
    expect(data).toEqual({ completed: false });
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT value FROM system_state WHERE key = $1",
      ["wizard_completed"]
    );
  });

  it("returns completed: true when key exists with value '1'", async () => {
    mockQuery.mockResolvedValue({ rows: [{ value: "1" }] });
    const resp = await GET();
    const data = await resp.json();
    expect(data).toEqual({ completed: true });
  });

  it("returns completed: false when DB query throws (fail-open)", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    const resp = await GET();
    const data = await resp.json();
    expect(data).toEqual({ completed: false });
  });
});

describe("PUT /api/wizard/status", () => {
  it("upserts wizard_completed when completed is true", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const req = new NextRequest("http://localhost/api/wizard/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    const resp = await PUT(req);
    const data = await resp.json();
    expect(data).toEqual({ completed: true });
    expect(mockQuery).toHaveBeenCalledWith(
      "INSERT INTO system_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      ["wizard_completed", "1"]
    );
  });

  it("deletes wizard_completed when completed is false", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const req = new NextRequest("http://localhost/api/wizard/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: false }),
    });
    const resp = await PUT(req);
    const data = await resp.json();
    expect(data).toEqual({ completed: false });
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM system_state WHERE key = $1",
      ["wizard_completed"]
    );
  });

  it("returns 503 when DB write fails", async () => {
    mockQuery.mockRejectedValue(new Error("db down"));
    const req = new NextRequest("http://localhost/api/wizard/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });

    const resp = await PUT(req);
    const data = await resp.json();

    expect(resp.status).toBe(503);
    expect(data).toEqual({
      completed: false,
      error: "Failed to update wizard status",
    });
  });
});
