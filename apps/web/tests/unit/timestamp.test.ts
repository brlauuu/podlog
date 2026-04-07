import { formatTimestamp } from "@/lib/timestamp";

describe("formatTimestamp", () => {
  test("under one hour shows MM:SS", () => {
    expect(formatTimestamp(90)).toBe("1:30");
  });

  test("over one hour shows H:MM:SS", () => {
    expect(formatTimestamp(3661)).toBe("1:01:01");
  });

  test("zero is 0:00", () => {
    expect(formatTimestamp(0)).toBe("0:00");
  });

  it("pads hours when padHours is true", () => {
    expect(formatTimestamp(3661, { padHours: true })).toBe("01:01:01");
  });

  it("pads minutes when padHours is true and no hours", () => {
    expect(formatTimestamp(65, { padHours: true })).toBe("01:05");
  });
});
