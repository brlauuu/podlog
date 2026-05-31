/**
 * Tests for the formatDuration helper exported from
 * apps/web/src/app/feeds/_lib/types.ts (#763). The file is mostly
 * type-only; coverage was reported as 0% because the helper had no
 * exercising test.
 */
import { formatDuration } from "@/app/feeds/_lib/types";

describe("formatDuration", () => {
  it("returns empty string for null", () => {
    expect(formatDuration(null)).toBe("");
  });

  it("returns empty string for 0 (falsy guard)", () => {
    expect(formatDuration(0)).toBe("");
  });

  it("formats sub-minute durations as 0m", () => {
    expect(formatDuration(45)).toBe("0m");
  });

  it("formats whole-minute durations", () => {
    expect(formatDuration(60)).toBe("1m");
    expect(formatDuration(90)).toBe("1m");
    expect(formatDuration(59 * 60)).toBe("59m");
  });

  it("formats hour-spanning durations as 'Xh Ym'", () => {
    expect(formatDuration(3600)).toBe("1h 0m");
    expect(formatDuration(3661)).toBe("1h 1m");
    expect(formatDuration(2 * 3600 + 30 * 60)).toBe("2h 30m");
  });
});
