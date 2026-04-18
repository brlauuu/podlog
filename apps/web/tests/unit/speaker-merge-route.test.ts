/**
 * Tests for POST /api/episodes/[id]/speakers/merge.
 *
 * Exercises the transactional handler with a mocked pg client so
 * the BEGIN/COMMIT/ROLLBACK flow, validation, missing-label check,
 * and error path all get real coverage. Pure-validation tests for
 * the validateMergeRequest helper live alongside in this file.
 *
 * @jest-environment node
 */
const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockConnect = jest.fn();

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { connect: mockConnect },
}));

import { NextRequest } from "next/server";
import { validateMergeRequest } from "@/lib/validateMergeRequest";

type RouteModule = typeof import("@/app/api/episodes/[id]/speakers/merge/route");
let POST: RouteModule["POST"];

beforeAll(async () => {
  const mod: RouteModule = await import(
    "@/app/api/episodes/[id]/speakers/merge/route"
  );
  POST = mod.POST;
});

beforeEach(() => {
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockConnect.mockReset();
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
});

function call(id: string, bodyText: string | null) {
  const req = new NextRequest(
    `http://localhost/api/episodes/${id}/speakers/merge`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: bodyText ?? "",
    }
  );
  return POST(req, { params: Promise.resolve({ id }) });
}

describe("validateMergeRequest (pure)", () => {
  test("valid request passes", () => {
    expect(
      validateMergeRequest({
        source_labels: ["SPEAKER_01"],
        target_label: "SPEAKER_00",
      })
    ).toBeNull();
  });

  test("missing source_labels rejected", () => {
    expect(validateMergeRequest({ target_label: "SPEAKER_00" })).toEqual({
      error: "source_labels must be a non-empty array",
    });
  });

  test("non-string element in source_labels rejected", () => {
    expect(
      validateMergeRequest({
        source_labels: ["SPEAKER_01", 42],
        target_label: "SPEAKER_00",
      })
    ).toEqual({ error: "source_labels must contain non-empty strings" });
  });

  test("target_label present in source_labels rejected", () => {
    expect(
      validateMergeRequest({
        source_labels: ["SPEAKER_00"],
        target_label: "SPEAKER_00",
      })
    ).toEqual({ error: "target_label must not appear in source_labels" });
  });
});

describe("POST /api/episodes/[id]/speakers/merge", () => {
  it("returns 400 on invalid JSON", async () => {
    const resp = await call("ep-1", "{not json");
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({ error: "Invalid JSON" });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("returns 400 when validation fails (skipping DB)", async () => {
    const resp = await call(
      "ep-1",
      JSON.stringify({ source_labels: [], target_label: "SPEAKER_00" })
    );
    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({
      error: "source_labels must be a non-empty array",
    });
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("commits and reassigns segments on happy path", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (/^BEGIN/.test(sql)) return Promise.resolve({});
      if (/SELECT DISTINCT speaker_label/.test(sql)) {
        return Promise.resolve({
          rows: [
            { speaker_label: "SPEAKER_00" },
            { speaker_label: "SPEAKER_01" },
          ],
        });
      }
      if (/^UPDATE segments/.test(sql)) return Promise.resolve({ rowCount: 42 });
      if (/^DELETE FROM speaker_names/.test(sql)) return Promise.resolve({});
      if (/^COMMIT/.test(sql)) return Promise.resolve({});
      return Promise.resolve({});
    });

    const resp = await call(
      "ep-1",
      JSON.stringify({
        source_labels: ["SPEAKER_01"],
        target_label: "SPEAKER_00",
      })
    );

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true, merged_segments: 42 });

    const sqlStatements = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(sqlStatements[0]).toBe("BEGIN");
    expect(sqlStatements.some((s) => /^UPDATE segments/.test(s))).toBe(true);
    expect(sqlStatements.some((s) => /^DELETE FROM speaker_names/.test(s))).toBe(
      true
    );
    expect(sqlStatements[sqlStatements.length - 1]).toBe("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("rolls back and returns 400 when a label is missing from episode", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (/^BEGIN/.test(sql)) return Promise.resolve({});
      if (/SELECT DISTINCT speaker_label/.test(sql)) {
        return Promise.resolve({ rows: [{ speaker_label: "SPEAKER_00" }] });
      }
      if (/^ROLLBACK/.test(sql)) return Promise.resolve({});
      return Promise.resolve({});
    });

    const resp = await call(
      "ep-1",
      JSON.stringify({
        source_labels: ["SPEAKER_99"],
        target_label: "SPEAKER_00",
      })
    );

    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({
      error: "Labels not found in episode: SPEAKER_99",
    });
    const sqlStatements = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(sqlStatements).toContain("ROLLBACK");
    expect(sqlStatements).not.toContain("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
  });

  it("rolls back and returns 500 when an inner query throws", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockClientQuery.mockImplementation((sql: string) => {
      if (/^BEGIN/.test(sql)) return Promise.resolve({});
      if (/SELECT DISTINCT speaker_label/.test(sql)) {
        return Promise.resolve({
          rows: [
            { speaker_label: "SPEAKER_00" },
            { speaker_label: "SPEAKER_01" },
          ],
        });
      }
      if (/^UPDATE segments/.test(sql)) {
        return Promise.reject(new Error("deadlock"));
      }
      if (/^ROLLBACK/.test(sql)) return Promise.resolve({});
      return Promise.resolve({});
    });

    const resp = await call(
      "ep-1",
      JSON.stringify({
        source_labels: ["SPEAKER_01"],
        target_label: "SPEAKER_00",
      })
    );

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to merge speakers" });
    expect(mockClientQuery.mock.calls.map((c) => c[0])).toContain("ROLLBACK");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("defaults merged_segments to 0 when UPDATE rowCount is null", async () => {
    mockClientQuery.mockImplementation((sql: string) => {
      if (/^BEGIN/.test(sql)) return Promise.resolve({});
      if (/SELECT DISTINCT speaker_label/.test(sql)) {
        return Promise.resolve({
          rows: [
            { speaker_label: "SPEAKER_00" },
            { speaker_label: "SPEAKER_01" },
          ],
        });
      }
      if (/^UPDATE segments/.test(sql)) return Promise.resolve({ rowCount: null });
      return Promise.resolve({});
    });

    const resp = await call(
      "ep-1",
      JSON.stringify({
        source_labels: ["SPEAKER_01"],
        target_label: "SPEAKER_00",
      })
    );

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true, merged_segments: 0 });
  });
});
