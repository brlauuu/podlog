/**
 * @jest-environment node
 */
const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: mockQuery } }));

type RouteModule = typeof import("@/app/api/ask/coverage/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/ask/coverage/route");
  GET = mod.GET;
});

beforeEach(() => {
  mockQuery.mockReset();
});

describe("GET /api/ask/coverage", () => {
  it("returns processed/total counts and manual-upload flag", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ processed: "42", total: "100", has_manual_uploads: true }],
    });

    const resp = await GET();

    expect(resp.status).toBe(200);
    expect(await resp.json()).toEqual({
      processed: 42,
      total: 100,
      has_manual_uploads: true,
    });

    const sql: string = mockQuery.mock.calls[0][0];
    expect(sql).toContain("status = 'done'");
    expect(sql).toContain("feed_id IS NULL");
  });

  it("coerces string counts to numbers", async () => {
    mockQuery.mockResolvedValue({
      rows: [{ processed: "0", total: "0", has_manual_uploads: false }],
    });

    const resp = await GET();

    const data = await resp.json();
    expect(data.processed).toBe(0);
    expect(data.total).toBe(0);
    expect(typeof data.processed).toBe("number");
    expect(typeof data.total).toBe("number");
    expect(data.has_manual_uploads).toBe(false);
  });
});
