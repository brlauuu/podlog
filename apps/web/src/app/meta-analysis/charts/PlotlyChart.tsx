"use client";

import dynamic from "next/dynamic";
import type { Data, Layout, Config } from "plotly.js";
import { usePlotlyTheme } from "./usePlotlyTheme";

const Plot = dynamic(() => import("react-plotly.js"), {
  ssr: false,
  loading: () => (
    <div className="h-[360px] flex items-center justify-center text-sm text-muted-foreground">
      Loading chart…
    </div>
  ),
});

interface Props {
  data: Data[];
  layout?: Partial<Layout>;
  config?: Partial<Config>;
  onPointClick?: (episodeId: string) => void;
  height?: number;
}

export default function PlotlyChart({ data, layout, config, onPointClick, height = 360 }: Props) {
  const template = usePlotlyTheme();
  return (
    <div style={{ width: "100%", height }}>
      <Plot
        data={data}
        layout={{
          autosize: true,
          template: template as unknown as Layout["template"],
          margin: { l: 60, r: 20, t: 70, b: 110 },
          ...layout,
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
