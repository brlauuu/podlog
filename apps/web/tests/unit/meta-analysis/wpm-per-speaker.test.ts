import { buildWpmPerSpeaker } from "@/app/meta-analysis/charts/transforms/wpmPerSpeaker";
import type { PerSpeaker, PerFeed } from "@/lib/metaAnalysisTypes";

const SPEAKERS: PerSpeaker[] = [
  { speaker_display_name: "Alice", feed_id: "a", wpm: 150,
    episode_ids: [], total_words: 1000, total_seconds: 400, turn_count: 10, normalized_name: "alice", episode_count: 1 },
  { speaker_display_name: "Bob",   feed_id: "a", wpm: 120,
    episode_ids: [], total_words: 600, total_seconds: 300, turn_count: 8, normalized_name: "bob", episode_count: 1 },
  { speaker_display_name: "Carl",  feed_id: "b", wpm: 135,
    episode_ids: [], total_words: 800, total_seconds: 355, turn_count: 12, normalized_name: "carl", episode_count: 1 },
];
const FEEDS: PerFeed[] = [
  { feed_id: "a", title: "A" } as PerFeed,
  { feed_id: "b", title: "B" } as PerFeed,
];

describe("buildWpmPerSpeaker", () => {
  it("sorts by wpm desc within feed, keeps top N per feed", () => {
    const rows = buildWpmPerSpeaker(SPEAKERS, FEEDS, 5);
    const a = rows.filter((r) => r.feed_id === "a");
    expect(a[0].speaker_display_name).toBe("Alice");
    expect(a[1].speaker_display_name).toBe("Bob");
  });
});
