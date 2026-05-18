import { classifyRoles, buildSpeakerSeries } from "@/app/meta-analysis/charts/transforms/speakerRows";
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";

const row = (over: Partial<PerEpisodeSpeaker>): PerEpisodeSpeaker => ({
  feed_id: "f1",
  feed_title: "Feed 1",
  episode_id: "e1",
  episode_title: "Ep 1",
  published_at: "2026-01-01T00:00:00Z",
  display_name: "Alice",
  role: "host",
  source: "confirmed",
  minutes: 10,
  words: 1500,
  ...over,
});

describe("classifyRoles (confirmed source)", () => {
  it("majority wins; ties resolve to host", () => {
    const rows: PerEpisodeSpeaker[] = [
      row({ display_name: "Alice", role: "host" }),
      row({ display_name: "Alice", role: "host", episode_id: "e2" }),
      row({ display_name: "Alice", role: "guest", episode_id: "e3" }),
      row({ display_name: "Bob", role: "guest" }),
      row({ display_name: "Carol", role: "host" }),
      row({ display_name: "Carol", role: "guest", episode_id: "e2" }),
    ];
    const m = classifyRoles(rows, "confirmed");
    expect(m.get("f1|Alice")).toBe(true);  // 2 host vs 1 guest -> host
    expect(m.get("f1|Bob")).toBe(false);
    expect(m.get("f1|Carol")).toBe(true);  // tie -> host
  });

  it("ignores rows with non-confirmed source", () => {
    const rows: PerEpisodeSpeaker[] = [
      row({ display_name: "Alice", role: null, source: "inferred_high" }),
    ];
    const m = classifyRoles(rows, "confirmed");
    expect(m.size).toBe(0);
  });
});

describe("classifyRoles (inferred_high source)", () => {
  it("inherits confirmed-host mapping when present", () => {
    const rows: PerEpisodeSpeaker[] = [
      row({ display_name: "Alice", role: "host", source: "confirmed" }),
      row({ display_name: "Alice", role: null, source: "inferred_high", episode_id: "e2" }),
    ];
    const m = classifyRoles(rows, "inferred_high");
    expect(m.get("f1|Alice")).toBe(true);
  });

  it("falls back to 25% heuristic when name is unknown in confirmed (above threshold = host)", () => {
    // Feed has 4 inferred episodes (e1..e4). Alice appears in 1/4 = 25% (>= 0.25 -> host).
    const rows: PerEpisodeSpeaker[] = [];
    for (let i = 1; i <= 4; i++) {
      rows.push(row({
        display_name: "Bob", role: null, source: "inferred_high", episode_id: `e${i}`,
      }));
    }
    rows.push(row({
      display_name: "Alice", role: null, source: "inferred_high", episode_id: "e1",
    }));
    const m = classifyRoles(rows, "inferred_high");
    expect(m.get("f1|Alice")).toBe(true);  // 1/4 = 25%, threshold is >= 0.25
    expect(m.get("f1|Bob")).toBe(true);    // 4/4 = 100%
  });

  it("falls back to 25% heuristic when name is unknown (below threshold = guest)", () => {
    // Feed has 8 inferred episodes. Alice appears in 1/8 = 12.5% < 25% -> guest.
    const rows: PerEpisodeSpeaker[] = [];
    for (let i = 1; i <= 8; i++) {
      rows.push(row({
        display_name: "Bob", role: null, source: "inferred_high", episode_id: `e${i}`,
      }));
    }
    rows.push(row({
      display_name: "Alice", role: null, source: "inferred_high", episode_id: "e1",
    }));
    const m = classifyRoles(rows, "inferred_high");
    expect(m.get("f1|Alice")).toBe(false);  // 1/8 = 12.5% < 25%
  });
});

describe("buildSpeakerSeries", () => {
  it("collapses non-host rows into a single combined-guests series per feed", () => {
    const rows: PerEpisodeSpeaker[] = [
      row({ display_name: "Alice", role: "host" }),
      row({ display_name: "Bob",   role: "guest", minutes: 5, words: 800 }),
      row({ display_name: "Carol", role: "guest", minutes: 7, words: 900 }),
    ];
    const series = buildSpeakerSeries(rows, "minutes", "confirmed");
    const fs = series.get("f1")!;
    expect(fs.hosts.map((h) => h.display_name)).toEqual(["Alice"]);
    expect(fs.combinedGuests).toHaveLength(1);
    expect(fs.combinedGuests[0].value).toBe(12);  // 5 + 7
    expect(fs.combinedGuests[0].guest_names).toEqual(["Bob", "Carol"]);
    expect(fs.combinedGuests[0].guest_count).toBe(2);
  });

  it("hosts series uses minutes when metric=minutes, words when metric=words", () => {
    const rows: PerEpisodeSpeaker[] = [
      row({ display_name: "Alice", role: "host", minutes: 10, words: 1500 }),
    ];
    const seriesMin = buildSpeakerSeries(rows, "minutes", "confirmed");
    const seriesWords = buildSpeakerSeries(rows, "words", "confirmed");
    expect(seriesMin.get("f1")!.hosts[0].points[0].value).toBe(10);
    expect(seriesWords.get("f1")!.hosts[0].points[0].value).toBe(1500);
  });
});
