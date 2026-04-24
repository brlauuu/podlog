import { setMetaAnalysisStale } from "@/lib/metaAnalysisStale";

const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

describe("setMetaAnalysisStale", () => {
  beforeEach(() => {
    mockQuery.mockReset();
  });

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  it("UPSERTs the stale flag as a unique UUID token", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await setMetaAnalysisStale();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("system_state"),
      ["meta_analysis_stale", expect.stringMatching(UUID_RE)]
    );
  });

  it("rotates the token on each call (race-safety contract)", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await setMetaAnalysisStale();
    await setMetaAnalysisStale();
    const firstToken = (mockQuery.mock.calls[0][1] as string[])[1];
    const secondToken = (mockQuery.mock.calls[1][1] as string[])[1];
    expect(firstToken).not.toBe(secondToken);
    expect(firstToken).toMatch(UUID_RE);
    expect(secondToken).toMatch(UUID_RE);
  });

  it("swallows DB errors so route handlers are not broken", async () => {
    const err = new Error("db down");
    mockQuery.mockRejectedValue(err);
    const spy = jest.spyOn(console, "error").mockImplementation(() => {});
    await expect(setMetaAnalysisStale()).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith("setMetaAnalysisStale failed:", err);
    spy.mockRestore();
  });
});
