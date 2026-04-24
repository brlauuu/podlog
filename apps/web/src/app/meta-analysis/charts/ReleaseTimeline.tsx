"use client";

import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend,
} from "recharts";
import { buildReleaseTimeline } from "./transforms/releaseTimeline";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerFeed, TimelineMonthly } from "@/lib/metaAnalysisTypes";

interface Props { timeline: TimelineMonthly[]; feeds: PerFeed[]; }

export default function ReleaseTimeline({ timeline, feeds }: Props) {
  const data = buildReleaseTimeline(timeline, feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No published episodes.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <AreaChart data={data}>
          <XAxis dataKey="month" />
          <YAxis />
          <Tooltip />
          <Legend />
          {feeds.map((f) => (
            <Area
              key={f.feed_id}
              type="monotone"
              dataKey={f.feed_id}
              stackId="1"
              stroke={colorForFeed(f.feed_id)}
              fill={colorForFeed(f.feed_id)}
              fillOpacity={0.4}
              name={f.title}
            />
          ))}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
