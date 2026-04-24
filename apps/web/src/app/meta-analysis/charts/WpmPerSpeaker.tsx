"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { buildWpmPerSpeaker } from "./transforms/wpmPerSpeaker";
import type { PerFeed, PerSpeaker } from "@/lib/metaAnalysisTypes";

interface Props { speakers: PerSpeaker[]; feeds: PerFeed[]; }

export default function WpmPerSpeaker({ speakers, feeds }: Props) {
  const data = buildWpmPerSpeaker(speakers, feeds, 20);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">
      No confirmed speakers yet.
    </p>;
  }
  return (
    <div style={{ width: "100%", height: Math.max(180, data.length * 22) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 80 }}>
          <XAxis type="number" />
          <YAxis type="category" dataKey="speaker_display_name" width={140} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(0)} wpm`} />
          <Bar dataKey="wpm">
            {data.map((d) => <Cell key={`${d.feed_id}-${d.speaker_display_name}`} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
