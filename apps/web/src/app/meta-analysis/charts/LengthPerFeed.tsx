"use client";

import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, ErrorBar, Cell,
} from "recharts";
import { buildLengthPerFeed } from "./transforms/lengthPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { feeds: PerFeed[]; }

export default function LengthPerFeed({ feeds }: Props) {
  const data = buildLengthPerFeed(feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No feeds yet.</p>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
          <XAxis type="number" />
          <YAxis type="category" dataKey="title" width={100} />
          <Tooltip formatter={(v) => `${Number(v).toFixed(1)} min`} />
          <Bar dataKey="avg">
            {data.map((d) => <Cell key={d.feed_id} fill={d.color} />)}
            <ErrorBar dataKey="std" width={4} strokeWidth={1} stroke="#94a3b8" />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
