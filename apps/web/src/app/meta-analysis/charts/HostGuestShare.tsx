"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { buildHostGuestShare } from "./transforms/hostGuestShare";
import { colorForFeed } from "@/lib/metaAnalysisColors";
import type { PerEpisode, PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; feeds: PerFeed[]; }

export default function HostGuestShare({ episodes, feeds }: Props) {
  const data = buildHostGuestShare(episodes, feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">
      No confirmed hosts yet — rename speakers on episode pages to populate.
    </p>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" stackOffset="expand">
          <XAxis type="number" tickFormatter={(v) => `${Math.round(v * 100)}%`} />
          <YAxis type="category" dataKey="title" width={100} />
          <Tooltip formatter={(v: number) => `${v}%`} />
          <Bar dataKey="host_pct" stackId="1">
            {data.map((d) => <Cell key={d.feed_id} fill={colorForFeed(d.feed_id)} />)}
          </Bar>
          <Bar dataKey="guest_pct" stackId="1" fill="#94a3b8" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
