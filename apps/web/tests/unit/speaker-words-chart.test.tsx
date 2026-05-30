/**
 * @jest-environment jsdom
 *
 * Tests for SpeakerWordsChart (PRD-06; coverage gap closed in #764).
 * Mirrors the SpeakerMinutesChart tests since the components share most
 * of their shape — only the metric and axis-format differ.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

type ChartProps = {
  data: unknown[];
  layout?: { title?: { text?: string }; yaxis?: { tickformat?: string } };
  onPointClick?: (id: string) => void;
};
const capturedProps: { current: ChartProps | null } = { current: null };
jest.mock("@/app/meta-analysis/charts/PlotlyChart", () => ({
  __esModule: true,
  default: (props: ChartProps) => {
    capturedProps.current = props;
    return <div data-testid="plotly-chart" />;
  },
}));

beforeEach(() => {
  pushMock.mockReset();
  capturedProps.current = null;
});

import SpeakerWordsChart from "@/app/meta-analysis/charts/SpeakerWordsChart";

function row(overrides: Partial<PerEpisodeSpeaker> = {}): PerEpisodeSpeaker {
  return {
    feed_id: "f1",
    feed_title: "Feed One",
    episode_id: "ep1",
    episode_title: "Ep 1",
    published_at: "2026-01-01T00:00:00Z",
    display_name: "Alice",
    role: "host",
    source: "confirmed",
    minutes: 10,
    words: 1500,
    ...overrides,
  };
}

describe("<SpeakerWordsChart>", () => {
  it("renders the empty-state paragraph when no rows match", () => {
    render(<SpeakerWordsChart rows={[]} source="confirmed" />);
    expect(screen.getByText(/No data for Confirmed source/)).toBeInTheDocument();
  });

  it("emits scatter traces with lines+markers and an integer tick format on Y", () => {
    render(
      <SpeakerWordsChart
        rows={[row({ words: 1500 }), row({ episode_id: "e2", words: 2400 })]}
        source="confirmed"
      />,
    );
    const traces = capturedProps.current!.data as Array<{ mode: string; type: string }>;
    expect(traces.length).toBeGreaterThan(0);
    expect(traces[0].mode).toBe("lines+markers");
    expect(traces[0].type).toBe("scatter");
    expect(capturedProps.current!.layout?.yaxis?.tickformat).toBe(",.0f");
  });

  it("includes the Inferred — HIGH label in the title when source=inferred_high and rows exist", () => {
    render(
      <SpeakerWordsChart
        rows={[
          row({
            source: "inferred_high",
            role: null,
            display_name: "Carla",
          }),
        ]}
        source="inferred_high"
      />,
    );
    const title = capturedProps.current!.layout?.title?.text ?? "";
    expect(title).toContain("Inferred — HIGH");
  });

  it("wires router.push as the point-click handler by default", () => {
    render(<SpeakerWordsChart rows={[row()]} source="confirmed" />);
    capturedProps.current!.onPointClick!("ep-9");
    expect(pushMock).toHaveBeenCalledWith("/episodes/ep-9");
  });

  it("omits the click handler when enableClickOpen=false", () => {
    render(
      <SpeakerWordsChart rows={[row()]} source="confirmed" enableClickOpen={false} />,
    );
    expect(capturedProps.current!.onPointClick).toBeUndefined();
  });

  it("collapses multiple guests into a single combined trace", () => {
    const rows = [
      row({ display_name: "Alice", role: "host" }),
      row({ display_name: "B", role: "guest", words: 800 }),
      row({ display_name: "C", role: "guest", words: 400 }),
    ];
    render(<SpeakerWordsChart rows={rows} source="confirmed" />);
    const traces = capturedProps.current!.data as Array<{ name: string }>;
    const guestTrace = traces.find((t) => t.name === "Guests (combined)");
    expect(guestTrace).toBeDefined();
  });
});
