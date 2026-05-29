"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { Loader2 } from "lucide-react";
import type { Data, Layout, Config } from "plotly.js";
import type { PlotParams } from "react-plotly.js";
import { usePlotlyTheme } from "./usePlotlyTheme";

// Issue #746: react-plotly.js defaults to the full plotly.js bundle (~4.5MB
// min). All PRD-06 charts only use scatter traces, so we wire the factory
// to plotly.js-cartesian-dist-min (~1.4MB) — a 68% drop in the lazy chunk.
type Factory = (plotly: unknown) => ComponentType<PlotParams>;

const Plot = dynamic(
  () =>
    Promise.all([
      import("react-plotly.js/factory"),
      import("plotly.js-cartesian-dist-min"),
    ]).then(([factoryMod, plotlyMod]) => {
      const create = (factoryMod as unknown as { default: Factory }).default;
      const plotly = (plotlyMod as unknown as { default?: unknown }).default ?? plotlyMod;
      return { default: create(plotly) };
    }),
  {
    ssr: false,
    loading: () => (
      <div className="h-[360px] flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Loading chart…
      </div>
    ),
  },
);

interface Props {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
  onPointClick?: (episodeId: string) => void;
  height?: number;
}

export default function PlotlyChart({ data, layout, config, onPointClick, height = 360 }: Props) {
  const template = usePlotlyTheme();

  const themeLayout: Partial<Layout> = template === "plotly_dark"
    ? {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: "#e2e8f0" },
        xaxis: { gridcolor: "rgba(148,163,184,0.15)", zerolinecolor: "rgba(148,163,184,0.3)" },
        yaxis: { gridcolor: "rgba(148,163,184,0.15)", zerolinecolor: "rgba(148,163,184,0.3)" },
        legend: { bgcolor: "rgba(0,0,0,0)", font: { color: "#e2e8f0" } },
        hoverlabel: {
          bgcolor: "#1e293b",
          bordercolor: "rgba(148,163,184,0.3)",
          font: { color: "#e2e8f0" },
        },
      }
    : {
        paper_bgcolor: "rgba(0,0,0,0)",
        plot_bgcolor: "rgba(0,0,0,0)",
        font: { color: "#0f172a" },
        xaxis: { gridcolor: "rgba(15,23,42,0.08)", zerolinecolor: "rgba(15,23,42,0.2)" },
        yaxis: { gridcolor: "rgba(15,23,42,0.08)", zerolinecolor: "rgba(15,23,42,0.2)" },
        legend: { bgcolor: "rgba(0,0,0,0)", font: { color: "#0f172a" } },
        hoverlabel: {
          bgcolor: "#ffffff",
          bordercolor: "rgba(15,23,42,0.2)",
          font: { color: "#0f172a" },
        },
      };

  return (
    <div style={{ width: "100%", height }}>
      <Plot
        data={data}
        layout={{
          autosize: true,
          margin: { l: 60, r: 20, t: 70, b: 110 },
          ...themeLayout,
          ...layout,
          // Deep-merge xaxis/yaxis so theme grid colors stay applied:
          xaxis: { ...themeLayout.xaxis, ...layout?.xaxis },
          yaxis: { ...themeLayout.yaxis, ...layout?.yaxis },
          font: { ...themeLayout.font, ...layout?.font },
          legend: { ...themeLayout.legend, ...layout?.legend },
          hoverlabel: { ...themeLayout.hoverlabel, ...layout?.hoverlabel },
        }}
        config={{ displaylogo: false, responsive: true, ...config }}
        useResizeHandler
        style={{ width: "100%", height: "100%" }}
        onClick={(ev) => {
          if (!onPointClick) return;
          const p = ev.points?.[0] as { customdata?: unknown } | undefined;
          const cd = p?.customdata;
          // Convention: last entry of customdata is the episode_id.
          if (Array.isArray(cd) && cd.length > 0) {
            const last = cd[cd.length - 1];
            if (typeof last === "string") onPointClick(last);
          }
        }}
      />
    </div>
  );
}
