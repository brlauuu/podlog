"use client";

import dynamic from "next/dynamic";
import { useEffect, useState, type ComponentType } from "react";
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
  // Tailwind's md: is 768px. Matched in JS because Plotly's modebar is not
  // ours to style with a class.
  const [isNarrow, setIsNarrow] = useState(false);
  useEffect(() => {
    // Guarded: matchMedia is missing in jsdom and in any other non-browser
    // consumer. Without this the whole chart throws rather than falling back
    // to desktop behaviour -- it took out six existing tests when added.
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsNarrow(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

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

  const narrow = isNarrow ? narrowTitle(layout) : null;

  return (
    <div style={{ width: "100%", height: height + (narrow?.extraHeight ?? 0) }}>
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
          ...narrow?.layout,
        }}
        // #989: the modebar is nine 22px buttons per chart -- 27 unhittable
        // targets on a phone, for interactions (box select, lasso) that need a
        // pointer regardless. Hidden below md: rather than enlarged. An
        // explicit `config.displayModeBar` from a caller still wins.
        config={{
          displaylogo: false,
          responsive: true,
          displayModeBar: isNarrow ? false : undefined,
          ...config,
        }}
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

/** Characters per title line that fit a phone-width chart. */
const NARROW_TITLE_CHARS = 36;
const NARROW_TITLE_LINE_PX = 26;

/**
 * Plotly never wraps a title: it breaks lines only at `<br>`. On a phone a
 * long one was cut off at both ends ("r minutes per episode — All podcasts (")
 * along with its subtitle, which on the diff chart is the only place the
 * per-feed summary appears (#1121). Wrap it here, and give the extra lines
 * room in the top margin.
 */
function narrowTitle(
  layout: Partial<Layout> | undefined,
): { layout: Partial<Layout>; extraHeight: number } | null {
  const title = layout?.title;
  const text = typeof title === "string" ? title : title?.text;
  if (!text) return null;
  const wrapped = wrapPlotlyTitle(text, NARROW_TITLE_CHARS);
  const base = typeof title === "string" ? {} : title;
  const top = 16 + wrapped.lines * NARROW_TITLE_LINE_PX;
  return {
    layout: {
      // Pinned to the top so extra lines grow down into the margin made for
      // them, rather than out from its middle into the plot.
      title: { ...base, text: wrapped.text, y: 1, yref: "container", yanchor: "top", pad: { t: 12 } },
      margin: { l: 60, r: 20, b: 110, ...layout?.margin, t: top },
    },
    // The chart grows by what the title took, so the plot keeps its height.
    extraHeight: Math.max(0, top - (layout?.margin?.t ?? 70)),
  };
}

/**
 * Word-wrap Plotly's pseudo-HTML at `maxChars` visible characters a line.
 * Existing `<br>`s are kept; an `<i>` or `<sub>` open across a new break is
 * closed before it and reopened after, so each line stands on its own.
 */
export function wrapPlotlyTitle(text: string, maxChars: number): { text: string; lines: number } {
  const out: string[] = [];
  for (const source of text.split(/<br\s*\/?>/i)) {
    const open: string[] = [];
    let line = "";
    let width = 0;
    for (const token of source.match(/<\/?[a-z]+>|[^<\s]+|\s+/gi) ?? []) {
      const tag = token.match(/^<(\/?)([a-z]+)>$/i);
      if (tag) {
        if (tag[1]) open.pop();
        else open.push(tag[2]);
        line += token;
      } else if (/^\s+$/.test(token)) {
        if (width > 0) {
          line += " ";
          width += 1;
        }
      } else {
        if (width > 0 && width + token.length > maxChars) {
          out.push(line.trimEnd() + [...open].reverse().map((t) => `</${t}>`).join(""));
          line = open.map((t) => `<${t}>`).join("");
          width = 0;
        }
        line += token;
        width += token.length;
      }
    }
    out.push(line.trimEnd());
  }
  return { text: out.join("<br>"), lines: out.length };
}
