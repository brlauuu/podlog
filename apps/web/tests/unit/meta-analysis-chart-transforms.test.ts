/**
 * Tests for the meta-analysis chart transforms.
 *
 * The charts themselves are thin Recharts wrappers; these pure
 * transform functions are where the real logic lives. Tests cover
 * each transform's shape, sorting, filtering, and edge cases.
 */
import { buildCostPerFeed } from "@/app/meta-analysis/charts/transforms/costPerFeed";
import { buildEpisodeLengthTrend } from "@/app/meta-analysis/charts/transforms/episodeLengthTrend";
import { buildHostGuestShare } from "@/app/meta-analysis/charts/transforms/hostGuestShare";
import { buildLengthPerFeed } from "@/app/meta-analysis/charts/transforms/lengthPerFeed";
import { buildProcessingTime } from "@/app/meta-analysis/charts/transforms/processingTime";
import { buildReleaseTimeline } from "@/app/meta-analysis/charts/transforms/releaseTimeline";
import { buildTokensPerEpisode } from "@/app/meta-analysis/charts/transforms/tokensPerEpisode";
import { buildTurnDensity } from "@/app/meta-analysis/charts/transforms/turnDensity";
import { buildWpmPerSpeaker } from "@/app/meta-analysis/charts/transforms/wpmPerSpeaker";
import type {
  PerEpisode,
  PerFeed,
  PerSpeaker,
  TimelineMonthly,
} from "@/lib/metaAnalysisTypes";

function feed(overrides: Partial<PerFeed> = {}): PerFeed {
  return {
    feed_id: "f1",
    title: "Feed 1",
    episode_count: 10,
    avg_length_min: 30,
    std_length_min: 5,
    total_words: 1000,
    total_tokens_segments: 5000,
    total_tokens_chunks: 3000,
    total_cost_usd: 0,
    total_audio_minutes: 300,
    inferred_host_name: null,
    ...overrides,
  };
}

function episode(overrides: Partial<PerEpisode> = {}): PerEpisode {
  return {
    episode_id: "ep-1",
    feed_id: "f1",
    published_at: "2026-01-01T00:00:00Z",
    duration_secs: 1800,
    word_count: 1000,
    token_count_segments: 500,
    token_count_chunks: 300,
    speaker_count: 2,
    turn_count: 50,
    wpm: 120,
    host_share: null,
    fireworks_cost_usd: null,
    transcribe_duration_secs: 60,
    diarize_duration_secs: 30,
    inference_provider_used: "local",
    ...overrides,
  };
}

describe("buildCostPerFeed", () => {
  it("drops feeds with zero cost and sorts by cost desc", () => {
    const result = buildCostPerFeed([
      feed({ feed_id: "a", title: "A", total_cost_usd: 0 }),
      feed({ feed_id: "b", title: "B", total_cost_usd: 1.5 }),
      feed({ feed_id: "c", title: "C", total_cost_usd: 3.0 }),
    ]);
    expect(result.map((r) => r.feed_id)).toEqual(["c", "b"]);
    expect(result[0].cost).toBe(3.0);
    expect(typeof result[0].color).toBe("string");
  });

  it("returns an empty list when no feed has cost", () => {
    expect(buildCostPerFeed([feed({ total_cost_usd: 0 })])).toEqual([]);
  });
});

describe("buildEpisodeLengthTrend", () => {
  it("groups by feed_id and sorts chronologically within each group", () => {
    const result = buildEpisodeLengthTrend([
      episode({ feed_id: "a", published_at: "2026-02-01T00:00:00Z", duration_secs: 3600 }),
      episode({ feed_id: "a", published_at: "2026-01-01T00:00:00Z", duration_secs: 1800 }),
      episode({ feed_id: "b", published_at: "2026-01-15T00:00:00Z", duration_secs: 600 }),
    ]);

    expect(Object.keys(result).sort()).toEqual(["a", "b"]);
    expect(result.a.map((p) => p.duration_min)).toEqual([30, 60]);
    expect(result.b).toHaveLength(1);
  });

  it("skips episodes without published_at", () => {
    const result = buildEpisodeLengthTrend([episode({ published_at: null })]);
    expect(result).toEqual({});
  });
});

describe("buildHostGuestShare", () => {
  it("averages host_share per feed and returns host + guest percentages", () => {
    const result = buildHostGuestShare(
      [
        episode({ feed_id: "a", host_share: 0.5 }),
        episode({ feed_id: "a", host_share: 0.7 }),
        episode({ feed_id: "b", host_share: null }),
      ],
      [feed({ feed_id: "a", title: "A" }), feed({ feed_id: "b", title: "B" })]
    );

    expect(result).toHaveLength(1);
    expect(result[0]).toEqual({
      feed_id: "a",
      title: "A",
      host_pct: 60,
      guest_pct: 40,
    });
  });

  it("returns an empty list when no episodes carry a host_share", () => {
    const result = buildHostGuestShare(
      [episode({ host_share: null })],
      [feed({ feed_id: "f1" })]
    );
    expect(result).toEqual([]);
  });
});

describe("buildLengthPerFeed", () => {
  it("maps feeds and sorts by average length desc", () => {
    const result = buildLengthPerFeed([
      feed({ feed_id: "a", avg_length_min: 20, std_length_min: 3 }),
      feed({ feed_id: "b", avg_length_min: 40, std_length_min: 8 }),
    ]);
    expect(result.map((r) => r.feed_id)).toEqual(["b", "a"]);
    expect(result[0].avg).toBe(40);
    expect(result[0].std).toBe(8);
  });
});

describe("buildProcessingTime", () => {
  it("groups total durations by inference_provider_used", () => {
    const result = buildProcessingTime([
      episode({ inference_provider_used: "local", transcribe_duration_secs: 10, diarize_duration_secs: 5 }),
      episode({ inference_provider_used: "local", transcribe_duration_secs: 20, diarize_duration_secs: 0 }),
      episode({ inference_provider_used: "fireworks", transcribe_duration_secs: 5, diarize_duration_secs: 2 }),
    ]);

    const byProv = Object.fromEntries(result.map((r) => [r.provider, r.seconds]));
    expect(byProv.local).toEqual([15, 20]);
    expect(byProv.fireworks).toEqual([7]);
  });

  it("drops episodes with zero total processing time", () => {
    const result = buildProcessingTime([
      episode({ transcribe_duration_secs: null, diarize_duration_secs: null }),
    ]);
    expect(result).toEqual([]);
  });

  it("treats null provider as 'local'", () => {
    const result = buildProcessingTime([
      episode({ inference_provider_used: null, transcribe_duration_secs: 5, diarize_duration_secs: 1 }),
    ]);
    expect(result[0].provider).toBe("local");
  });
});

describe("buildReleaseTimeline", () => {
  it("pivots monthly rows into one column per feed with 0 fill", () => {
    const tl: TimelineMonthly[] = [
      { month: "2026-01", feed_id: "a", episode_count: 2, total_words: 100, total_duration_min: 30 },
      { month: "2026-02", feed_id: "a", episode_count: 3, total_words: 200, total_duration_min: 40 },
      { month: "2026-02", feed_id: "b", episode_count: 1, total_words: 50, total_duration_min: 20 },
    ];
    const feeds = [feed({ feed_id: "a" }), feed({ feed_id: "b" })];

    const result = buildReleaseTimeline(tl, feeds);

    expect(result).toEqual([
      { month: "2026-01", a: 2, b: 0 },
      { month: "2026-02", a: 3, b: 1 },
    ]);
  });
});

describe("buildTokensPerEpisode", () => {
  it("emits segments + chunks per published episode, sorted by date", () => {
    const result = buildTokensPerEpisode([
      episode({ episode_id: "e1", published_at: "2026-03-01T00:00:00Z", token_count_segments: 100, token_count_chunks: 10 }),
      episode({ episode_id: "e2", published_at: "2026-01-01T00:00:00Z", token_count_segments: 50, token_count_chunks: 5 }),
      episode({ episode_id: "e3", published_at: null }),
    ]);

    expect(result.map((p) => p.episode_id)).toEqual(["e2", "e1"]);
    expect(result[0].segments).toBe(50);
    expect(result[1].chunks).toBe(10);
  });
});

describe("buildTurnDensity", () => {
  it("emits one point per episode with duration and turns/min", () => {
    const result = buildTurnDensity([
      episode({ episode_id: "e1", duration_secs: 600, turn_count: 30 }),
      episode({ episode_id: "e2", duration_secs: 0, turn_count: 10 }), // filtered
    ]);
    expect(result).toHaveLength(1);
    expect(result[0].episode_id).toBe("e1");
    expect(result[0].duration_min).toBe(10);
    expect(result[0].turns_per_min).toBe(3);
  });
});

describe("buildWpmPerSpeaker", () => {
  function speaker(overrides: Partial<PerSpeaker> = {}): PerSpeaker {
    return {
      speaker_display_name: "Alice",
      normalized_name: "alice",
      feed_id: "f1",
      episode_ids: ["e1"],
      episode_count: 1,
      wpm: 100,
      total_words: 500,
      total_seconds: 300,
      turn_count: 10,
      ...overrides,
    };
  }

  it("returns top N speakers per feed sorted by wpm desc", () => {
    const speakers = [
      speaker({ speaker_display_name: "A", feed_id: "f1", wpm: 120 }),
      speaker({ speaker_display_name: "B", feed_id: "f1", wpm: 150 }),
      speaker({ speaker_display_name: "C", feed_id: "f1", wpm: 80 }),
    ];
    const feeds = [feed({ feed_id: "f1", title: "Feed 1" })];

    const result = buildWpmPerSpeaker(speakers, feeds, 2);

    expect(result.map((r) => r.speaker_display_name)).toEqual(["B", "A"]);
    expect(result[0].wpm).toBe(150);
    expect(result[0].feed_title).toBe("Feed 1");
  });

  it("skips feeds with no speakers", () => {
    const result = buildWpmPerSpeaker([], [feed({ feed_id: "f1" })], 5);
    expect(result).toEqual([]);
  });

  it("default topN of 20 keeps all entries when there are fewer", () => {
    const result = buildWpmPerSpeaker(
      [speaker({ feed_id: "f1", wpm: 100 }), speaker({ feed_id: "f1", wpm: 80 })],
      [feed({ feed_id: "f1" })]
    );
    expect(result).toHaveLength(2);
  });
});
