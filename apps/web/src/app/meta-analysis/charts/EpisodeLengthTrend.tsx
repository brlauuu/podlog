"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { buildEpisodeLengthTrend } from "./transforms/episodeLengthTrend";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; feeds: PerFeed[]; }

export default function EpisodeLengthTrend({ episodes, feeds }: Props) {
  const grouped = buildEpisodeLengthTrend(episodes);
  // Recharts needs a flat array; use a merged row shape keyed by ts.
  const allTs = Array.from(new Set(
    Object.values(grouped).flat().map((p) => p.ts)
  )).sort();
  const data = allTs.map((ts) => {
    const row: Record<string, number | string> = {
      ts, date: new Date(ts).toISOString().slice(0, 10),
    };
    for (const f of feeds) {
      const hit = grouped[f.feed_id]?.find((p) => p.ts === ts);
      if (hit) row[f.feed_id] = hit.duration_min;
    }
    return row;
  });

  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No dated episodes.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="date" />
          <YAxis label={{ value: "min", angle: -90, position: "insideLeft" }} />
          <Tooltip />
          <Legend />
          {feeds.map((f) => (
            <Line key={f.feed_id} type="monotone" dataKey={f.feed_id}
              stroke={colorForFeed(f.feed_id)} name={f.title}
              connectNulls dot={false} />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
