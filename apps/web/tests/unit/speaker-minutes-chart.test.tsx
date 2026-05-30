/**
 * @jest-environment jsdom
 *
 * Tests for SpeakerMinutesChart (PRD-06; coverage gap closed in #764).
 * The chart consumes PerEpisodeSpeaker rows, builds Plotly traces, and
 * delegates rendering to PlotlyChart. We mock PlotlyChart as a probe so
 * we can assert the trace + layout shape without actually mounting Plotly.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

// PlotlyChart probe — captures the props it would have rendered.
type ChartProps = {
  data: unknown[];
  layout?: { title?: { text?: string } };
  height?: number;
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

import SpeakerMinutesChart from "@/app/meta-analysis/charts/SpeakerMinutesChart";

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

describe("<SpeakerMinutesChart>", () => {
  it("renders the empty-state paragraph when no rows match the source", () => {
    render(<SpeakerMinutesChart rows={[]} source="confirmed" />);
    expect(screen.getByText(/No data for Confirmed source/)).toBeInTheDocument();
    expect(screen.queryByTestId("plotly-chart")).not.toBeInTheDocument();
  });

  it("renders the empty-state with the Inferred — HIGH label when source=inferred_high", () => {
    render(<SpeakerMinutesChart rows={[]} source="inferred_high" />);
    expect(screen.getByText(/No data for Inferred — HIGH source/)).toBeInTheDocument();
  });

  it("emits one host trace per host with line+markers mode", () => {
    const rows = [
      row({ display_name: "Alice", role: "host", episode_id: "e1", minutes: 8 }),
      row({ display_name: "Alice", role: "host", episode_id: "e2", minutes: 12 }),
      row({ display_name: "Bob", role: "host", episode_id: "e1", minutes: 5 }),
    ];
    render(<SpeakerMinutesChart rows={rows} source="confirmed" />);

    expect(capturedProps.current).not.toBeNull();
    const traces = capturedProps.current!.data as Array<{
      name: string;
      mode: string;
      type: string;
    }>;
    // Two hosts → two traces (no guests rendered).
    expect(traces).toHaveLength(2);
    expect(traces[0].mode).toBe("lines+markers");
    expect(traces[0].type).toBe("scatter");
    const names = traces.map((t) => t.name).sort();
    expect(names).toEqual(["Alice (host)", "Bob (host)"]);
  });

  it("collapses guest rows into a single combined 'Guests (combined)' trace", () => {
    const rows = [
      row({ display_name: "Alice", role: "host", episode_id: "e1", minutes: 10 }),
      row({ display_name: "Carla", role: "guest", episode_id: "e1", minutes: 5 }),
      row({ display_name: "Dan",   role: "guest", episode_id: "e1", minutes: 3 }),
    ];
    render(<SpeakerMinutesChart rows={rows} source="confirmed" />);
    const traces = capturedProps.current!.data as Array<{
      name: string;
      line?: { dash?: string };
    }>;
    // One host trace + one combined-guest trace.
    expect(traces).toHaveLength(2);
    const guest = traces.find((t) => t.name === "Guests (combined)");
    expect(guest).toBeDefined();
    expect(guest!.line?.dash).toBe("dash");
  });

  it("uses the short feed name in the title when exactly one feed is present", () => {
    render(
      <SpeakerMinutesChart
        rows={[row({ feed_title: "Lenny's Podcast: Product | Career | Growth" })]}
        source="confirmed"
      />,
    );
    const title = capturedProps.current!.layout?.title?.text ?? "";
    expect(title).toContain("Lenny's Podcast");
    // Source label included
    expect(title).toContain("(Confirmed)");
  });

  it("uses 'All podcasts' in the title when multiple feeds are present", () => {
    render(
      <SpeakerMinutesChart
        rows={[
          row({ feed_id: "f1", feed_title: "Feed One" }),
          row({ feed_id: "f2", feed_title: "Feed Two" }),
        ]}
        source="confirmed"
      />,
    );
    const title = capturedProps.current!.layout?.title?.text ?? "";
    expect(title).toContain("All podcasts");
  });

  it("wires onPointClick to router.push by default", () => {
    render(<SpeakerMinutesChart rows={[row()]} source="confirmed" />);
    const onClick = capturedProps.current!.onPointClick;
    expect(onClick).toBeDefined();
    onClick!("ep-42");
    expect(pushMock).toHaveBeenCalledWith("/episodes/ep-42");
  });

  it("does not wire onPointClick when enableClickOpen=false", () => {
    render(
      <SpeakerMinutesChart rows={[row()]} source="confirmed" enableClickOpen={false} />,
    );
    expect(capturedProps.current!.onPointClick).toBeUndefined();
  });
});
