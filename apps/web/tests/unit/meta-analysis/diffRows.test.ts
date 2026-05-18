import { filterDiffRows, summarizeDiff } from "@/app/meta-analysis/charts/transforms/diffRows";
import type { EpisodeSpeakerDiff } from "@/lib/metaAnalysisTypes";

const diff = (over: Partial<EpisodeSpeakerDiff>): EpisodeSpeakerDiff => ({
  feed_id: "f1",
  feed_title: "Feed 1",
  episode_id: "e1",
  episode_title: "Ep 1",
  published_at: "2026-01-01T00:00:00Z",
  source: "confirmed",
  host_mean: 10,
  host_min: 8,
  host_max: 12,
  host_count: 2,
  host_names: ["A", "B"],
  guest_mean: 15,
  guest_min: 12,
  guest_max: 18,
  guest_count: 2,
  guest_names: ["C", "D"],
  diff: 5,
  band_lo: 0,
  band_hi: 10,
  ...over,
});

describe("filterDiffRows", () => {
  it("returns only the requested source", () => {
    const rows = [
      diff({ source: "confirmed" }),
      diff({ source: "inferred_high", episode_id: "e2" }),
    ];
    expect(filterDiffRows(rows, "confirmed")).toHaveLength(1);
    expect(filterDiffRows(rows, "confirmed")[0].episode_id).toBe("e1");
  });

  it("sorts by published_at ascending", () => {
    const rows = [
      diff({ episode_id: "e2", published_at: "2026-03-01T00:00:00Z" }),
      diff({ episode_id: "e1", published_at: "2026-01-01T00:00:00Z" }),
    ];
    const sorted = filterDiffRows(rows, "confirmed");
    expect(sorted.map((r) => r.episode_id)).toEqual(["e1", "e2"]);
  });
});

describe("summarizeDiff", () => {
  it("counts episodes by which side led, ignoring exact zeros", () => {
    const rows = [
      diff({ diff: 3 }),
      diff({ diff: -2, episode_id: "e2" }),
      diff({ diff: 0, episode_id: "e3" }),
    ];
    const s = summarizeDiff(rows);
    expect(s.guestsMore).toBe(1);
    expect(s.hostsMore).toBe(1);
    expect(s.total).toBe(3);
  });
});
