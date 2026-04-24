"use client";

import { ComposedChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { buildProcessingTime } from "./transforms/processingTime";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

function quartiles(arr: number[]) {
  const s = [...arr].sort((a, b) => a - b);
  const q = (p: number) => s[Math.min(s.length - 1, Math.floor(s.length * p))];
  return { min: s[0], q1: q(0.25), median: q(0.5), q3: q(0.75), max: s[s.length - 1] };
}

interface Props { episodes: PerEpisode[]; }

export default function ProcessingTimeDistribution({ episodes }: Props) {
  const rows = buildProcessingTime(episodes);
  const data = rows.map((r) => {
    const q = quartiles(r.seconds);
    return {
      provider: r.provider,
      min: q.min, iqrStart: q.q1, iqrHeight: q.q3 - q.q1,
      median: q.median, max: q.max, seconds: r.seconds.length,
    };
  });
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No processing data yet.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <ComposedChart data={data}>
          <XAxis dataKey="provider" />
          <YAxis label={{ value: "sec", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          {/* Render min-max whisker behind IQR box */}
          <Bar dataKey="max" fill="transparent" stroke="#94a3b8" />
          <Bar dataKey="iqrHeight" stackId="iqr" fill="#6366f1" />
          <ReferenceLine y={0} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
