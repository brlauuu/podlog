import { summarizeProviderTiming } from "@/app/meta-analysis/charts/transforms/providerTiming";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

function ep(over: Partial<PerEpisode> = {}): PerEpisode {
  return {
    episode_id: "e1", feed_id: "f1", published_at: "2026-06-01T00:00:00Z",
    duration_secs: 3600, word_count: 0, token_count_segments: 0,
    token_count_chunks: 0, speaker_count: 2, turn_count: 0, wpm: 0,
    host_share: null, fireworks_cost_usd: null,
    transcribe_duration_secs: 1800, diarize_duration_secs: 1800,
    inference_provider_used: "local",
    ...over,
  };
}

describe("summarizeProviderTiming (#976)", () => {
  it("groups by provider and reports episode counts", () => {
    const rows = summarizeProviderTiming([
      ep({ inference_provider_used: "local" }),
      ep({ inference_provider_used: "local" }),
      ep({ inference_provider_used: "fireworks" }),
    ]);
    const byProvider = Object.fromEntries(rows.map((r) => [r.provider, r.episodes]));
    expect(byProvider).toEqual({ local: 2, fireworks: 1 });
  });

  it("uses transcribe + diarize combined, never diarize alone", () => {
    // The trap this guards: on the Fireworks path the speaker labels arrive
    // inside the transcription artifact, so diarize is ~0.2s of JSON reading.
    // A diarize-only figure would read as "40,000x faster", which is false.
    const [row] = summarizeProviderTiming([
      ep({ duration_secs: 100, transcribe_duration_secs: 60, diarize_duration_secs: 40 }),
    ]);
    expect(row.medianRealtime).toBeCloseTo(1.0, 6);   // (60+40)/100
    expect(row.medianRealtime).not.toBeCloseTo(0.4, 6); // diarize alone
  });

  it("normalizes by audio length rather than comparing raw seconds", () => {
    // Local episodes are much longer on average, so raw seconds overstate the
    // gap. Two providers doing identical work per second of audio must come
    // out equal even when episode lengths differ.
    const rows = summarizeProviderTiming([
      ep({ inference_provider_used: "local", duration_secs: 7200,
           transcribe_duration_secs: 3600, diarize_duration_secs: 3600 }),
      ep({ inference_provider_used: "fireworks", duration_secs: 1800,
           transcribe_duration_secs: 900, diarize_duration_secs: 900 }),
    ]);
    const [a, b] = rows;
    expect(a.medianRealtime).toBeCloseTo(b.medianRealtime, 6);
  });

  it("reports median separately from mean", () => {
    // Median matters more here: the real local sample's max is 17x its min.
    const [row] = summarizeProviderTiming([
      ep({ duration_secs: 100, transcribe_duration_secs: 100, diarize_duration_secs: 0 }),
      ep({ duration_secs: 100, transcribe_duration_secs: 200, diarize_duration_secs: 0 }),
      ep({ duration_secs: 100, transcribe_duration_secs: 900, diarize_duration_secs: 0 }),
    ]);
    expect(row.medianRealtime).toBeCloseTo(2.0, 6);
    expect(row.meanRealtime).toBeCloseTo(4.0, 6);
  });

  it("excludes episodes with missing timings and counts them", () => {
    const [row] = summarizeProviderTiming([
      ep(),
      ep({ transcribe_duration_secs: null }),
      ep({ diarize_duration_secs: null }),
    ]);
    expect(row.episodes).toBe(1);
    expect(row.excluded).toBe(2);
  });

  it("excludes zero-length episodes rather than dividing by zero", () => {
    const rows = summarizeProviderTiming([ep({ duration_secs: 0 })]);
    expect(rows.every((r) => Number.isFinite(r.medianRealtime))).toBe(true);
    expect(rows[0]?.episodes ?? 0).toBe(0);
    expect(rows[0]?.excluded ?? 0).toBe(1);
  });

  it("buckets a null provider as unknown instead of dropping it", () => {
    const rows = summarizeProviderTiming([ep({ inference_provider_used: null })]);
    expect(rows.map((r) => r.provider)).toEqual(["unknown"]);
  });

  it("carries the sample window, since the numbers reflect that period's hardware", () => {
    const [row] = summarizeProviderTiming([
      ep({ published_at: "2026-05-06T00:00:00Z" }),
      ep({ published_at: "2026-07-02T00:00:00Z" }),
      ep({ published_at: null }),
    ]);
    expect(row.firstPublished).toBe("2026-05-06T00:00:00Z");
    expect(row.lastPublished).toBe("2026-07-02T00:00:00Z");
  });

  it("returns nothing for an empty library rather than a zero row", () => {
    expect(summarizeProviderTiming([])).toEqual([]);
  });

  it("orders providers by episode count, descending", () => {
    const rows = summarizeProviderTiming([
      ep({ inference_provider_used: "local" }),
      ep({ inference_provider_used: "fireworks" }),
      ep({ inference_provider_used: "fireworks" }),
    ]);
    expect(rows.map((r) => r.provider)).toEqual(["fireworks", "local"]);
  });
});
