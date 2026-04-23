import { buildLengthPerFeed } from "@/app/meta-analysis/charts/transforms/lengthPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A", episode_count: 10, avg_length_min: 40,
    std_length_min: 5, total_words: 0, total_tokens_segments: 0,
    total_tokens_chunks: 0, total_cost_usd: 0, total_audio_minutes: 0,
    inferred_host_name: null },
  { feed_id: "b", title: "B", episode_count: 5, avg_length_min: 60,
    std_length_min: 8, total_words: 0, total_tokens_segments: 0,
    total_tokens_chunks: 0, total_cost_usd: 0, total_audio_minutes: 0,
    inferred_host_name: null },
];

describe("buildLengthPerFeed", () => {
  it("returns bars with title / avg / std / color", () => {
    const rows = buildLengthPerFeed(FEEDS);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ title: "B", avg: 60, std: 8 });
    expect(rows[0].color).toMatch(/^#/);
  });

  it("sorts descending by avg length", () => {
    const rows = buildLengthPerFeed(FEEDS);
    expect(rows[0].title).toBe("B");   // 60 > 40
    expect(rows[1].title).toBe("A");
  });

  it("returns empty array when no feeds", () => {
    expect(buildLengthPerFeed([])).toEqual([]);
  });
});
