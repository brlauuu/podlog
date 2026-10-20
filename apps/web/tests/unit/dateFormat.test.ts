import { formatDate, formatDateTime, formatDayMonth } from "@/lib/dateFormat";

describe("formatDate", () => {
  it("formats an ISO date string as DD/MM/YYYY", () => {
    expect(formatDate("2026-04-26T10:00:00.000Z")).toMatch(/^\d{2}\/\d{2}\/2026$/);
  });

  it("zero-pads single-digit day and month", () => {
    expect(formatDate(new Date(2026, 0, 5))).toBe("05/01/2026");
  });

  it("formats a Date instance", () => {
    expect(formatDate(new Date(2026, 11, 31))).toBe("31/12/2026");
  });

  it("returns empty string for null / undefined", () => {
    expect(formatDate(null)).toBe("");
    expect(formatDate(undefined)).toBe("");
  });

  it("returns empty string for invalid input", () => {
    expect(formatDate("not-a-date")).toBe("");
  });
});

describe("formatDateTime", () => {
  it("appends zero-padded HH:mm:ss to the date", () => {
    expect(formatDateTime(new Date(2026, 0, 5, 9, 7, 3))).toBe("05/01/2026 09:07:03");
  });

  it("returns empty string for null", () => {
    expect(formatDateTime(null)).toBe("");
  });
});

describe("formatDayMonth (#1079)", () => {
  const now = new Date(2026, 9, 20);

  it("omits the year for a date in the current year", () => {
    expect(formatDayMonth(new Date(2026, 9, 5), now)).toBe("05/10");
  });

  it("adds the year for a date in another year", () => {
    expect(formatDayMonth(new Date(2019, 2, 14), now)).toBe("14/03/2019");
  });

  it("returns empty string for null / invalid", () => {
    expect(formatDayMonth(null, now)).toBe("");
    expect(formatDayMonth("not a date", now)).toBe("");
  });
});
