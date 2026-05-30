/**
 * @jest-environment jsdom
 *
 * Tests for the PlotlyChart wrapper component (PRD-06; coverage gap
 * closed in #764). The component uses next/dynamic with ssr:false to
 * lazy-load react-plotly.js + plotly.js-cartesian-dist-min. We mock
 * `next/dynamic` at module scope so the rendered Plot is a probe we can
 * inspect (data/layout/config) and trigger onClick on.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";

// Probe Plot — stash the props the wrapper passes to the dynamic Plot.
const captured: { props: Record<string, unknown> | null } = { props: null };

jest.mock("next/dynamic", () => ({
  __esModule: true,
  default: () => {
    function PlotStub(props: Record<string, unknown>) {
      captured.props = props;
      return (
        <div
          data-testid="plot-stub"
          onClick={() => {
            const onClick = props.onClick as
              | ((ev: { points: { customdata: unknown[] }[] }) => void)
              | undefined;
            onClick?.({ points: [{ customdata: ["title-fixture", "ep-fixture-id"] }] });
          }}
        />
      );
    }
    return PlotStub;
  },
}));

import PlotlyChart from "@/app/meta-analysis/charts/PlotlyChart";

beforeEach(() => {
  captured.props = null;
  document.documentElement.classList.remove("dark");
});

describe("<PlotlyChart>", () => {
  it("forwards data, custom layout, and merges responsive defaults into config", () => {
    render(
      <PlotlyChart
        data={[{ type: "scatter", x: [1, 2], y: [3, 4] }]}
        layout={{ title: { text: "Hi" } }}
        config={{ displaylogo: true }}
        height={420}
      />,
    );
    expect(captured.props).not.toBeNull();
    expect((captured.props!.data as Array<{ type: string }>).length).toBe(1);
    expect(
      (captured.props!.layout as { title?: { text?: string } }).title?.text,
    ).toBe("Hi");
    expect(
      (captured.props!.config as { displaylogo?: boolean; responsive?: boolean }),
    ).toEqual(expect.objectContaining({ displaylogo: true, responsive: true }));
  });

  it("applies the light-theme layout when <html> has no 'dark' class", () => {
    render(<PlotlyChart data={[]} />);
    const layout = captured.props!.layout as {
      paper_bgcolor?: string;
      font?: { color?: string };
      hoverlabel?: { bgcolor?: string };
    };
    expect(layout.paper_bgcolor).toBe("rgba(0,0,0,0)");
    expect(layout.font?.color).toBe("#0f172a");
    expect(layout.hoverlabel?.bgcolor).toBe("#ffffff");
  });

  it("applies the dark-theme layout when <html> has the 'dark' class", () => {
    document.documentElement.classList.add("dark");
    render(<PlotlyChart data={[]} />);
    const layout = captured.props!.layout as {
      font?: { color?: string };
      hoverlabel?: { bgcolor?: string };
    };
    expect(layout.font?.color).toBe("#e2e8f0");
    expect(layout.hoverlabel?.bgcolor).toBe("#1e293b");
  });

  it("deep-merges caller xaxis/yaxis with the theme grid colors", () => {
    render(
      <PlotlyChart
        data={[]}
        layout={{
          xaxis: { tickformat: ",.0f" },
          yaxis: { ticksuffix: " min" },
        }}
      />,
    );
    const layout = captured.props!.layout as {
      xaxis: { gridcolor?: string; tickformat?: string };
      yaxis: { gridcolor?: string; ticksuffix?: string };
    };
    // Caller-provided fields preserved
    expect(layout.xaxis.tickformat).toBe(",.0f");
    expect(layout.yaxis.ticksuffix).toBe(" min");
    // Theme grid color also applied (light theme default)
    expect(layout.xaxis.gridcolor).toBe("rgba(15,23,42,0.08)");
  });

  it("invokes onPointClick with the last entry of customdata when a point is clicked", () => {
    const onPointClick = jest.fn();
    render(<PlotlyChart data={[]} onPointClick={onPointClick} />);

    fireEvent.click(screen.getByTestId("plot-stub"));

    expect(onPointClick).toHaveBeenCalledWith("ep-fixture-id");
  });

  it("does nothing on click when onPointClick is not provided", () => {
    render(<PlotlyChart data={[]} />);
    // Should not throw and should not have called anything observable.
    fireEvent.click(screen.getByTestId("plot-stub"));
  });
});
