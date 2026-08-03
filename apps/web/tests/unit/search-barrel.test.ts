/**
 * @jest-environment node
 */
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: jest.fn() },
}));
jest.mock("@/lib/searchHybrid", () => ({
  mergeHybridSearchResults: jest.fn(),
}));

import { searchSegments, searchGrouped, searchMentions } from "@/lib/search";

describe("@/lib/search barrel", () => {
  it("re-exports the three search entry points as functions", () => {
    expect(typeof searchSegments).toBe("function");
    expect(typeof searchGrouped).toBe("function");
    expect(typeof searchMentions).toBe("function");
  });
});
