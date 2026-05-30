/**
 * @jest-environment jsdom
 *
 * Tests for HostGuestDiffChart (PRD-06; coverage gap closed in #764).
 * Mocks PlotlyChart so the trace + layout shape can be asserted without
 * mounting the lazy Plotly bundle.
 */
import React from "react";
import { render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import type { EpisodeSpeakerDiff } from "@/lib/metaAnalysisTypes";

const pushMock = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
}));

type Shape = {
  type: string;
  y0?: number;
  y1?: number;
  line?: { dash?: string };
};
type ChartProps = {
  data: Array<{ name?: string; mode?: string; fill?: string; line?: { width?: number } }>;
  layout?: {
    title?: { text?: string };
    yaxis?: { ticksuffix?: string; title?: { text?: string } };
    shapes?: Shape[];
  };
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

import HostGuestDiffChart from "@/app/meta-analysis/charts/HostGuestDiffChart";

function diffRow(overrides: Partial<EpisodeSpeakerDiff> = {}): EpisodeSpeakerDiff {
  return {
    feed_id: "f1",
    feed_title: "Feed One",
    episode_id: "ep1",
    episode_title: "Ep 1",
    published_at: "2026-01-01T00:00:00Z",
    source: "confirmed",
    host_mean: 10,
    host_min: 8,
    host_max: 12,
    host_count: 1,
    host_names: ["Alice"],
    guest_mean: 5,
    guest_min: 4,
    guest_max: 6,
    guest_count: 1,
    guest_names: ["Bob"],
    diff: -5,
    band_lo: -8,
    band_hi: -2,
    ...overrides,
  };
}

describe("<HostGuestDiffChart>", () => {
  it("renders the empty-state paragraph when no rows match", () => {
    render(<HostGuestDiffChart rows={[]} source="confirmed" />);
    expect(
      screen.getByText(/No episodes with both hosts and guests for Confirmed source/),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("plotly-chart")).not.toBeInTheDocument();
  });

  it("emits 3 traces per feed (invisible upper band, filled lower band, center line)", () => {
    render(<HostGuestDiffChart rows={[diffRow()]} source="confirmed" />);
    expect(capturedProps.current!.data).toHaveLength(3);
    const [upper, lower, center] = capturedProps.current!.data;
    // Upper band: width 0, no fill, no name
    expect(upper.line?.width).toBe(0);
    expect((upper as { fill?: string }).fill).toBeUndefined();
    // Lower band: width 0, fill="tonexty"
    expect(lower.line?.width).toBe(0);
    expect(lower.fill).toBe("tonexty");
    // Center line: lines+markers + has a name
    expect(center.mode).toBe("lines+markers");
    expect(center.name).toContain("guest − host avg");
  });

  it("renders 6 traces (3 per feed) when two feeds are present", () => {
    render(
      <HostGuestDiffChart
        rows={[
          diffRow({ feed_id: "f1", feed_title: "Feed One" }),
          diffRow({ feed_id: "f2", feed_title: "Feed Two" }),
        ]}
        source="confirmed"
      />,
    );
    expect(capturedProps.current!.data).toHaveLength(6);
  });

  it("uses the short feed name in the title when exactly one feed is present", () => {
    render(
      <HostGuestDiffChart
        rows={[diffRow({ feed_title: "Dwarkesh Podcast" })]}
        source="confirmed"
      />,
    );
    const title = capturedProps.current!.layout?.title?.text ?? "";
    // FEED_SHORT maps "Dwarkesh Podcast" → "Dwarkesh"
    expect(title).toContain("Dwarkesh");
  });

  it("uses 'All podcasts' in the title when multiple feeds are present", () => {
    render(
      <HostGuestDiffChart
        rows={[
          diffRow({ feed_id: "f1" }),
          diffRow({ feed_id: "f2" }),
        ]}
        source="confirmed"
      />,
    );
    expect(capturedProps.current!.layout?.title?.text ?? "").toContain("All podcasts");
  });

  it("renders the dotted y=0 reference line via a layout shape", () => {
    render(<HostGuestDiffChart rows={[diffRow()]} source="confirmed" />);
    const shapes = capturedProps.current!.layout?.shapes ?? [];
    expect(shapes).toHaveLength(1);
    expect(shapes[0].type).toBe("line");
    expect(shapes[0].y0).toBe(0);
    expect(shapes[0].y1).toBe(0);
    expect(shapes[0].line?.dash).toBe("dot");
  });

  it("annotates the subtitle with the guests-more / hosts-more counts", () => {
    render(
      <HostGuestDiffChart
        rows={[
          diffRow({ episode_id: "e1", diff: -3 }),  // host more (negative)
          diffRow({ episode_id: "e2", diff: 4 }),   // guest more
          diffRow({ episode_id: "e3", diff: 0 }),   // tie — counted as host per summarizeDiff convention
        ]}
        source="confirmed"
      />,
    );
    const title = capturedProps.current!.layout?.title?.text ?? "";
    expect(title).toMatch(/guests talked more in 1/);
    // host vs tie behaviour we don't pin here — just ensure both counters render.
    expect(title).toMatch(/hosts in \d+/);
  });

  it("wires the click handler to router.push by default", () => {
    render(<HostGuestDiffChart rows={[diffRow()]} source="confirmed" />);
    capturedProps.current!.onPointClick!("ep-77");
    expect(pushMock).toHaveBeenCalledWith("/episodes/ep-77");
  });

  it("does not wire the click handler when enableClickOpen=false", () => {
    render(
      <HostGuestDiffChart rows={[diffRow()]} source="confirmed" enableClickOpen={false} />,
    );
    expect(capturedProps.current!.onPointClick).toBeUndefined();
  });

  it("renders the Inferred — HIGH source label in the title", () => {
    render(
      <HostGuestDiffChart
        rows={[diffRow({ source: "inferred_high" })]}
        source="inferred_high"
      />,
    );
    expect(capturedProps.current!.layout?.title?.text ?? "").toContain(
      "Inferred — HIGH",
    );
  });
});
