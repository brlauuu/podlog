import { render, screen, within } from "@testing-library/react";
import ProviderTimingChart from "@/app/meta-analysis/charts/ProviderTimingChart";
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

describe("ProviderTimingChart (#976)", () => {
  it("shows a row per provider with the combined realtime factor", () => {
    render(
      <ProviderTimingChart
        rows={[
          ep({ inference_provider_used: "local", duration_secs: 100,
               transcribe_duration_secs: 60, diarize_duration_secs: 40 }),
          ep({ inference_provider_used: "fireworks", duration_secs: 100,
               transcribe_duration_secs: 1, diarize_duration_secs: 0.2 }),
        ]}
      />
    );
    // Scope to each row: median and mean coincide on a one-episode sample,
    // so an unscoped text query matches twice.
    const localRow = screen.getByText(/Local \(WhisperX \+ pyannote\)/).closest("tr")!;
    expect(within(localRow).getAllByText("1.00×").length).toBeGreaterThan(0);

    const fwRow = screen.getByText(/Fireworks \(bundled\)/).closest("tr")!;
    expect(within(fwRow).getAllByText("0.012×").length).toBeGreaterThan(0);
  });

  it("explains why diarization is not broken out separately", () => {
    // Without this note the numbers invite the wrong conclusion, which is the
    // main risk the issue called out.
    render(<ProviderTimingChart rows={[ep()]} />);
    expect(screen.getByText(/billed in the transcription step/i)).toBeInTheDocument();
    expect(screen.getByText(/combined/i)).toBeInTheDocument();
  });

  it("shows the sample window, since figures reflect that period's hardware", () => {
    render(
      <ProviderTimingChart
        rows={[
          ep({ published_at: "2026-05-06T00:00:00Z" }),
          ep({ published_at: "2026-07-02T00:00:00Z" }),
        ]}
      />
    );
    expect(screen.getByText(/2026-05-06 → 2026-07-02/)).toBeInTheDocument();
  });

  it("renders an empty state rather than a table of dashes", () => {
    render(<ProviderTimingChart rows={[ep({ transcribe_duration_secs: null })]} />);
    expect(screen.getByText(/No episodes with recorded/i)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("surfaces excluded episodes rather than hiding them", () => {
    render(
      <ProviderTimingChart
        rows={[ep(), ep({ diarize_duration_secs: null }), ep({ duration_secs: 0 })]}
      />
    );
    expect(screen.getByText(/\(\+2\)/)).toBeInTheDocument();
  });
});
