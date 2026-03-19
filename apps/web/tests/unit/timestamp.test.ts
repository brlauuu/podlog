import { buildTimestampUrl, formatTimestamp } from "@/lib/timestamp";

describe("buildTimestampUrl", () => {
  const baseEpisode = { id: "ep-123", audioUrl: "https://cdn.example.com/ep.mp3", audioLocalPath: null, episodeUrl: null };

  test("remote URL with #t= fragment when no episode URL", () => {
    const url = buildTimestampUrl(baseEpisode, 1234.7);
    expect(url).toBe("https://cdn.example.com/ep.mp3#t=1234");
  });

  test("episode URL is preferred over remote audio URL", () => {
    const ep = { ...baseEpisode, episodeUrl: "https://example.com/episodes/1" };
    const url = buildTimestampUrl(ep, 60);
    expect(url).toBe("https://example.com/episodes/1");
  });

  test("local URL is fallback when no remote URLs", () => {
    const ep = { ...baseEpisode, audioUrl: "", audioLocalPath: "/data/audio/archive/ep-123.mp3" };
    const url = buildTimestampUrl(ep, 60);
    expect(url).toMatch(/^\/api\/audio\/ep-123\/ep-123\.mp3/);
    expect(url).toContain("#t=60");
  });

  test("remote audio URL preferred over local path", () => {
    const ep = { ...baseEpisode, audioLocalPath: "/data/audio/archive/ep-123.mp3" };
    const url = buildTimestampUrl(ep, 60);
    expect(url).toBe("https://cdn.example.com/ep.mp3#t=60");
  });

  test("fractional seconds are floored", () => {
    const url = buildTimestampUrl(baseEpisode, 99.9);
    expect(url).toContain("#t=99");
  });

  test("zero seconds produces #t=0", () => {
    const url = buildTimestampUrl(baseEpisode, 0);
    expect(url).toContain("#t=0");
  });

  test("local path basename extraction prevents traversal in URL", () => {
    const ep = { ...baseEpisode, audioUrl: "", audioLocalPath: "/data/audio/archive/safe.mp3" };
    const url = buildTimestampUrl(ep, 0);
    expect(url).not.toContain("..");
    expect(url).toContain("safe.mp3");
  });
});

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
