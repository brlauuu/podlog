import { groupRowsByFeed } from "@/lib/search/grouping";

type Row = Parameters<typeof groupRowsByFeed>[0][number];

function row(overrides: Partial<Row>): Row {
  return {
    feed_id: "feed-1",
    feed_title: "Feed One",
    feed_mode: "full",
    episode_id: "ep-1",
    episode_title: "Ep Title",
    audio_url: "https://example.com/ep-1.mp3",
    audio_local_path: "/data/audio/archive/ep-1.mp3",
    episode_url: "https://example.com/ep-1",
    mention_count: 1,
    best_rank: "0.5",
    ...overrides,
  };
}

describe("groupRowsByFeed", () => {
  it("returns an empty array for empty input", () => {
    expect(groupRowsByFeed([])).toEqual([]);
  });

  it("groups rows by feed and sums mention counts within each group", () => {
    const groups = groupRowsByFeed([
      row({ feed_id: "feed-1", episode_id: "ep-1", mention_count: 3 }),
      row({ feed_id: "feed-1", episode_id: "ep-2", mention_count: 2 }),
      row({ feed_id: "feed-2", feed_title: "Feed Two", episode_id: "ep-3", mention_count: 5 }),
    ]);

    expect(groups).toHaveLength(2);
    const byId = Object.fromEntries(groups.map((g) => [g.feedId, g]));
    expect(byId["feed-1"].mentionCount).toBe(5);
    expect(byId["feed-1"].episodes).toHaveLength(2);
    expect(byId["feed-2"].mentionCount).toBe(5);
    expect(byId["feed-2"].episodes).toHaveLength(1);
  });

  it("parses best_rank string into a number", () => {
    const [group] = groupRowsByFeed([row({ best_rank: "0.1234" })]);
    expect(group.episodes[0].bestRank).toBeCloseTo(0.1234, 6);
    expect(typeof group.episodes[0].bestRank).toBe("number");
  });

  it("groups null feed_id rows together under the __manual__ key", () => {
    const groups = groupRowsByFeed([
      row({ feed_id: null, feed_title: "Manual episode", episode_id: "ep-m1", mention_count: 1 }),
      row({ feed_id: null, feed_title: "Manual episode", episode_id: "ep-m2", mention_count: 2 }),
    ]);
    expect(groups).toHaveLength(1);
    expect(groups[0].mentionCount).toBe(3);
    expect(groups[0].episodes.map((e) => e.episodeId)).toEqual(["ep-m1", "ep-m2"]);
  });

  it("preserves all per-episode fields from the source rows", () => {
    const [group] = groupRowsByFeed([
      row({
        episode_id: "ep-9",
        episode_title: "Nine",
        audio_url: "https://ex/9.mp3",
        audio_local_path: "/data/audio/raw/9.mp3",
        episode_url: "https://ex/9",
      }),
    ]);
    const ep = group.episodes[0];
    expect(ep.episodeId).toBe("ep-9");
    expect(ep.episodeTitle).toBe("Nine");
    expect(ep.audioUrl).toBe("https://ex/9.mp3");
    expect(ep.audioLocalPath).toBe("/data/audio/raw/9.mp3");
    expect(ep.episodeUrl).toBe("https://ex/9");
  });
});
