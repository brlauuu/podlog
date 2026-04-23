/**
 * @jest-environment node
 */
const mockClientQuery = jest.fn();
const mockClientRelease = jest.fn();
const mockConnect = jest.fn();

jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { connect: mockConnect },
}));

const mockSetStale = jest.fn();
jest.mock("@/lib/metaAnalysisStale", () => ({
  setMetaAnalysisStale: (...args: unknown[]) => mockSetStale(...args),
}));

import { NextRequest } from "next/server";

type RouteModule = typeof import("@/app/api/episodes/[id]/speakers/route");
let PUT: RouteModule["PUT"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/episodes/[id]/speakers/route");
  PUT = mod.PUT;
});

beforeEach(() => {
  mockClientQuery.mockReset();
  mockClientRelease.mockReset();
  mockConnect.mockReset();
  mockSetStale.mockReset();
  mockConnect.mockResolvedValue({
    query: mockClientQuery,
    release: mockClientRelease,
  });
  mockClientQuery.mockResolvedValue({ rowCount: 1 });
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
  it("upserts speaker_names and feed_speaker_cache inside a transaction", async () => {
    const resp = await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Alice",
    });

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({ ok: true });

    const sqlStatements = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(sqlStatements[0]).toBe("BEGIN");
    expect(sqlStatements[sqlStatements.length - 1]).toBe("COMMIT");

    const speakerNamesCall = mockClientQuery.mock.calls.find((c) =>
      /INSERT INTO speaker_names/.test(c[0])
    );
    expect(speakerNamesCall).toBeDefined();
    expect(speakerNamesCall![0]).toContain("ON CONFLICT");
    expect(speakerNamesCall![0]).toContain("inferred = false");
    expect(speakerNamesCall![0]).toContain("confirmed_by_user = true");
    expect(speakerNamesCall![1]).toEqual(["ep-1", "SPEAKER_00", "Alice"]);

    const cacheCall = mockClientQuery.mock.calls.find((c) =>
      /INSERT INTO feed_speaker_cache/.test(c[0])
    );
    expect(cacheCall).toBeDefined();
    expect(cacheCall![0]).toContain(
      "ON CONFLICT (feed_id, speaker_label, normalized_name)"
    );
    expect(cacheCall![0]).toContain(
      "occurrence_count = feed_speaker_cache.occurrence_count + 1"
    );
    expect(cacheCall![1]).toEqual(["ep-1", "SPEAKER_00", "Alice", "alice"]);

    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    expect(mockSetStale).toHaveBeenCalledTimes(1);
  });

  it("issues speaker_names INSERT before feed_speaker_cache INSERT", async () => {
    await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Alice",
    });

    const sqlStatements = mockClientQuery.mock.calls.map((c) => c[0]);
    const speakerNamesIdx = sqlStatements.findIndex((s) =>
      /INSERT INTO speaker_names/.test(s)
    );
    const cacheIdx = sqlStatements.findIndex((s) =>
      /INSERT INTO feed_speaker_cache/.test(s)
    );
    expect(speakerNamesIdx).toBeGreaterThan(-1);
    expect(cacheIdx).toBeGreaterThan(-1);
    expect(speakerNamesIdx).toBeLessThan(cacheIdx);
  });

  it("trims whitespace from display_name before persisting", async () => {
    await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "   Alice   ",
    });

    const speakerNamesCall = mockClientQuery.mock.calls.find((c) =>
      /INSERT INTO speaker_names/.test(c[0])
    );
    expect(speakerNamesCall![1][2]).toBe("Alice");

    const cacheCall = mockClientQuery.mock.calls.find((c) =>
      /INSERT INTO feed_speaker_cache/.test(c[0])
    );
    expect(cacheCall![1][2]).toBe("Alice");
    expect(cacheCall![1][3]).toBe("alice");
  });

  it("computes normalized_name with honorifics stripped", async () => {
    await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Dr. Jane Smith",
    });

    const cacheCall = mockClientQuery.mock.calls.find((c) =>
      /INSERT INTO feed_speaker_cache/.test(c[0])
    );
    expect(cacheCall![1][2]).toBe("Dr. Jane Smith");
    expect(cacheCall![1][3]).toBe("jane smith");
  });

  it("returns 400 when speaker_label is missing", async () => {
    const resp = await call("ep-1", { display_name: "Alice" });

    expect(resp.status).toBe(400);
    expect(await resp.json()).toEqual({
      error: "speaker_label and display_name are required",
    });
    expect(mockConnect).not.toHaveBeenCalled();
    expect(mockSetStale).not.toHaveBeenCalled();
  });

  it("returns 400 when display_name is blank whitespace", async () => {
    const resp = await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "   ",
    });

    expect(resp.status).toBe(400);
    expect(mockConnect).not.toHaveBeenCalled();
  });

  it("rolls back and returns 500 when speaker_names upsert throws", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockClientQuery.mockImplementation((sql: string) => {
      if (/^BEGIN/.test(sql)) return Promise.resolve({});
      if (/INSERT INTO speaker_names/.test(sql)) {
        return Promise.reject(new Error("constraint violation"));
      }
      if (/^ROLLBACK/.test(sql)) return Promise.resolve({});
      return Promise.resolve({});
    });

    const resp = await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Alice",
    });

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to update speaker name" });

    const sqlStatements = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(sqlStatements).toContain("ROLLBACK");
    expect(sqlStatements).not.toContain("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("rolls back and returns 500 when feed_speaker_cache upsert throws", async () => {
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});
    mockClientQuery.mockImplementation((sql: string) => {
      if (/^BEGIN/.test(sql)) return Promise.resolve({});
      if (/INSERT INTO speaker_names/.test(sql)) return Promise.resolve({ rowCount: 1 });
      if (/INSERT INTO feed_speaker_cache/.test(sql)) {
        return Promise.reject(new Error("cache upsert failed"));
      }
      if (/^ROLLBACK/.test(sql)) return Promise.resolve({});
      return Promise.resolve({});
    });

    const resp = await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Alice",
    });

    expect(resp.status).toBe(500);
    const sqlStatements = mockClientQuery.mock.calls.map((c) => c[0]);
    expect(sqlStatements.some((s) => /INSERT INTO speaker_names/.test(s))).toBe(true);
    expect(sqlStatements).toContain("ROLLBACK");
    expect(sqlStatements).not.toContain("COMMIT");
    expect(mockClientRelease).toHaveBeenCalledTimes(1);
    consoleErrorSpy.mockRestore();
  });

  it("uses the same client for both INSERT statements", async () => {
    await call("ep-1", {
      speaker_label: "SPEAKER_00",
      display_name: "Alice",
    });

    // pool.connect() must be called exactly once — both upserts share one transaction
    expect(mockConnect).toHaveBeenCalledTimes(1);
  });
});
