/**
 * Render smoke tests for the meta-analysis chart components.
 *
 * Recharts + jsdom has layout quirks (ResponsiveContainer measures 0×0),
 * so the focused behaviors here are:
 *   1. Empty-data branch renders the "no data" fallback.
 *   2. Non-empty render does not throw.
 *
 * @jest-environment jsdom
 */
import React from "react";
import { render } from "@testing-library/react";
import "@testing-library/jest-dom";

// Stub Recharts to a trivial wrapper so jsdom doesn't choke on layout.
jest.mock("recharts", () => {
  const React = jest.requireActual("react");
  type Props = React.PropsWithChildren<Record<string, unknown>>;
  const Passthrough = ({ children }: Props) => (
    <div data-testid="recharts-node">{children}</div>
  );
  return new Proxy({}, { get: () => Passthrough });
});

import CostPerFeed from "@/app/meta-analysis/charts/CostPerFeed";
import EpisodeLengthTrend from "@/app/meta-analysis/charts/EpisodeLengthTrend";
import HostGuestShare from "@/app/meta-analysis/charts/HostGuestShare";
import LengthPerFeed from "@/app/meta-analysis/charts/LengthPerFeed";
import ProcessingTimeDistribution from "@/app/meta-analysis/charts/ProcessingTimeDistribution";
import ReleaseTimeline from "@/app/meta-analysis/charts/ReleaseTimeline";
import TokensPerEpisode from "@/app/meta-analysis/charts/TokensPerEpisode";
import TurnDensity from "@/app/meta-analysis/charts/TurnDensity";
import WpmPerSpeaker from "@/app/meta-analysis/charts/WpmPerSpeaker";
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
    episode_count: 5,
    avg_length_min: 30,
    std_length_min: 5,
    total_words: 1000,
    total_tokens_segments: 500,
    total_tokens_chunks: 300,
    total_cost_usd: 2.5,
    total_audio_minutes: 150,
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
    turn_count: 40,
    wpm: 120,
    host_share: 0.55,
    fireworks_cost_usd: null,
    transcribe_duration_secs: 60,
    diarize_duration_secs: 30,
    inference_provider_used: "local",
    ...overrides,
  };
}

const speaker: PerSpeaker = {
  speaker_display_name: "Alice",
  normalized_name: "alice",
  feed_id: "f1",
  episode_ids: ["ep-1"],
  episode_count: 1,
  wpm: 120,
  total_words: 500,
  total_seconds: 300,
  turn_count: 10,
};

const tl: TimelineMonthly = {
  month: "2026-01",
  feed_id: "f1",
  episode_count: 2,
  total_words: 200,
  total_duration_min: 60,
};

describe("CostPerFeed", () => {
  it("shows empty-state when no feed has cost", () => {
    const { getByText } = render(<CostPerFeed feeds={[feed({ total_cost_usd: 0 })]} />);
    expect(getByText(/No remote inference spend/i)).toBeInTheDocument();
  });
  it("renders chart when at least one feed has cost", () => {
    expect(() => render(<CostPerFeed feeds={[feed()]} />)).not.toThrow();
  });
});

describe("EpisodeLengthTrend", () => {
  it("renders without throwing when empty", () => {
    expect(() => render(<EpisodeLengthTrend episodes={[]} feeds={[]} />)).not.toThrow();
  });
  it("renders with data", () => {
    expect(() => render(<EpisodeLengthTrend episodes={[episode()]} feeds={[feed()]} />)).not.toThrow();
  });
});

describe("HostGuestShare", () => {
  it("renders empty-state when no episode has host_share", () => {
    const { getByText } = render(
      <HostGuestShare episodes={[episode({ host_share: null })]} feeds={[feed()]} />
    );
    expect(getByText(/No confirmed hosts yet/i)).toBeInTheDocument();
  });
  it("renders chart with data", () => {
    expect(() => render(<HostGuestShare episodes={[episode()]} feeds={[feed()]} />)).not.toThrow();
  });
});

describe("LengthPerFeed", () => {
  it("renders with data", () => {
    expect(() => render(<LengthPerFeed feeds={[feed()]} />)).not.toThrow();
  });
  it("renders with empty feeds", () => {
    expect(() => render(<LengthPerFeed feeds={[]} />)).not.toThrow();
  });
});

describe("ProcessingTimeDistribution", () => {
  it("renders empty-state when no episode has processing duration", () => {
    const { getByText } = render(
      <ProcessingTimeDistribution
        episodes={[episode({ transcribe_duration_secs: null, diarize_duration_secs: null })]}
      />
    );
    expect(getByText(/No processing data yet/i)).toBeInTheDocument();
  });
  it("renders chart with data", () => {
    expect(() => render(<ProcessingTimeDistribution episodes={[episode()]} />)).not.toThrow();
  });
});

describe("ReleaseTimeline", () => {
  it("renders with data", () => {
    expect(() =>
      render(<ReleaseTimeline timeline={[tl]} feeds={[feed()]} />)
    ).not.toThrow();
  });
});

describe("TokensPerEpisode", () => {
  it("renders empty-state when no episode has a publish date", () => {
    const { getByText } = render(
      <TokensPerEpisode episodes={[episode({ published_at: null })]} />
    );
    expect(getByText(/No dated episodes/i)).toBeInTheDocument();
  });
  it("renders chart with data", () => {
    expect(() => render(<TokensPerEpisode episodes={[episode()]} />)).not.toThrow();
  });
});

describe("TurnDensity", () => {
  it("renders empty-state when no episodes have duration", () => {
    const { getByText } = render(
      <TurnDensity episodes={[episode({ duration_secs: 0 })]} feeds={[feed()]} />
    );
    expect(getByText(/No episode data/i)).toBeInTheDocument();
  });
  it("renders chart with data", () => {
    expect(() =>
      render(<TurnDensity episodes={[episode()]} feeds={[feed()]} />)
    ).not.toThrow();
  });
});

describe("WpmPerSpeaker", () => {
  it("renders empty-state when no speakers match", () => {
    const { getByText } = render(
      <WpmPerSpeaker speakers={[]} feeds={[feed()]} />
    );
    expect(getByText(/No confirmed speakers yet/i)).toBeInTheDocument();
  });
  it("renders chart with data", () => {
    expect(() =>
      render(<WpmPerSpeaker speakers={[speaker]} feeds={[feed()]} />)
    ).not.toThrow();
  });
});
