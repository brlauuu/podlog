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

  it("UPSERTs the stale flag as true", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    await setMetaAnalysisStale();
    expect(mockQuery).toHaveBeenCalledWith(
      expect.stringContaining("system_state"),
      ["meta_analysis_stale", "true"]
    );
  });

  it("swallows DB errors so route handlers are not broken", async () => {
    mockQuery.mockRejectedValue(new Error("db down"));
    await expect(setMetaAnalysisStale()).resolves.toBeUndefined();
  });
});
