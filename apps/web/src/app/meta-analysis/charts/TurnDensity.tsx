"use client";

import { ScatterChart, Scatter, XAxis, YAxis, Tooltip, ResponsiveContainer, ZAxis } from "recharts";
import { buildTurnDensity } from "./transforms/turnDensity";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; feeds: PerFeed[]; }

export default function TurnDensity({ episodes, feeds }: Props) {
  const points = buildTurnDensity(episodes);
  if (points.length === 0) {
    return <p className="text-sm text-muted-foreground">No episode data.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <ScatterChart>
          <XAxis type="number" dataKey="duration_min"
            label={{ value: "episode (min)", position: "insideBottom", offset: -4 }} />
          <YAxis type="number" dataKey="turns_per_min"
            label={{ value: "turns/min", angle: -90, position: "insideLeft" }} />
          <ZAxis range={[40, 40]} />
          <Tooltip />
          {feeds.map((f) => (
            <Scatter key={f.feed_id} name={f.title}
              data={points.filter((p) => p.feed_id === f.feed_id)}
              fill={colorForFeed(f.feed_id)} />
          ))}
        </ScatterChart>
      </ResponsiveContainer>
    </div>
  );
}
