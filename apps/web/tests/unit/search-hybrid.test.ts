/**
 * @jest-environment node
 */

import { mergeHybridSearchResults } from "@/lib/searchHybrid";

function makeFtsRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    start_time: "10",
    end_time: "20",
    speaker_label: "SPEAKER_00",
    speaker_display: "Host",
    snippet: "keyword hit",
    rank: "0.9",
    episode_id: "ep-1",
    episode_title: "Episode 1",
    audio_url: "https://example.com/audio.mp3",
    audio_local_path: null,
    episode_url: "https://example.com/ep1",
    has_diarization: true,
    diarization_error: null,
    feed_title: "Feed",
    feed_mode: "full",
    feed_id: "feed-1",
    ...overrides,
  };
}

function makeVecRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 2,
    start_time: "12",
    end_time: "22",
    speaker_label: "SPEAKER_00",
    speaker_display: "Host",
    text: "semantic vector match text",
    similarity: "0.8",
    episode_id: "ep-1",
    episode_title: "Episode 1",
    audio_url: "https://example.com/audio.mp3",
    audio_local_path: null,
    episode_url: "https://example.com/ep1",
    has_diarization: true,
    diarization_error: null,
    feed_title: "Feed",
    feed_mode: "full",
    feed_id: "feed-1",
    ...overrides,
  };
}

describe("mergeHybridSearchResults", () => {
  test("boosts FTS hit when vector hit lands in same episode/time bucket", () => {
    const merged = mergeHybridSearchResults({
      ftsRows: [makeFtsRow()],
      vecRows: [makeVecRow({ start_time: "25", end_time: "30" })],
      page: 1,
      pageSize: 20,
      ftsTotal: 1,
    });

    expect(merged.results).toHaveLength(1);
    expect(merged.results[0].id).toBe(1);
    expect(merged.total).toBe(1);
  });

  test("includes vector-only semantic matches with truncated snippet", () => {
    const longText = `${"semantic ".repeat(60)}tail`;
    const merged = mergeHybridSearchResults({
      ftsRows: [],
      vecRows: [makeVecRow({ text: longText, episode_id: "ep-2", start_time: "120" })],
      page: 1,
      pageSize: 20,
      ftsTotal: 0,
    });

    expect(merged.results).toHaveLength(1);
    expect(merged.results[0].episodeId).toBe("ep-2");
    expect(merged.results[0].snippet.endsWith("…")).toBe(true);
  });

  test("paginates sorted RRF results and preserves total from max(ftsTotal, merged)", () => {
    const merged = mergeHybridSearchResults({
      ftsRows: [
        makeFtsRow({ id: 1, episode_id: "ep-1", start_time: "0" }),
        makeFtsRow({ id: 2, episode_id: "ep-2", start_time: "60" }),
        makeFtsRow({ id: 3, episode_id: "ep-3", start_time: "120" }),
      ],
      vecRows: [],
      page: 2,
      pageSize: 1,
      ftsTotal: 99,
    });

    expect(merged.results).toHaveLength(1);
    expect(merged.results[0].episodeId).toBe("ep-2");
    expect(merged.total).toBe(99);
  });
});
