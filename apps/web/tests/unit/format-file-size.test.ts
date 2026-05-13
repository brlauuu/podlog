/**
 * Tests for lib/formatFileSize (#674). Tiny pure function — covers all
 * four range branches and the boundary values where the unit flips.
 */
import { formatFileSize } from "@/lib/formatFileSize";

describe("formatFileSize", () => {
  it("formats sub-KB values as bytes", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(1)).toBe("1 B");
    expect(formatFileSize(1023)).toBe("1023 B");
  });

  it("formats KB values to one decimal", () => {
    expect(formatFileSize(1024)).toBe("1.0 KB");
    expect(formatFileSize(1536)).toBe("1.5 KB");
    expect(formatFileSize(1024 * 1024 - 1)).toBe("1024.0 KB");
  });

  it("formats MB values to one decimal", () => {
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1024 * 1024 * 7.5)).toBe("7.5 MB");
    expect(formatFileSize(1024 * 1024 * 1024 - 1)).toBe("1024.0 MB");
  });

  it("formats GB values to two decimals", () => {
    expect(formatFileSize(1024 * 1024 * 1024)).toBe("1.00 GB");
    expect(formatFileSize(1024 * 1024 * 1024 * 2.345)).toBe("2.35 GB");
  });

  it("preserves the byte-branch literal for negatives (no special-case)", () => {
    // formatFileSize doesn't gate on negative input; the byte branch handles
    // it as-is. Documenting the current behavior so future "guard against
    // negatives" changes show up as a deliberate test update.
    expect(formatFileSize(-5)).toBe("-5 B");
  });
});
