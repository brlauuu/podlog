"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { buildCostPerFeed } from "./transforms/costPerFeed";
import type { PerFeed } from "@/lib/metaAnalysisTypes";

interface Props { feeds: PerFeed[]; }

export default function CostPerFeed({ feeds }: Props) {
  const data = buildCostPerFeed(feeds);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">
      No remote inference spend on record.
    </p>;
  }
  return (
    <div style={{ width: "100%", height: 200 }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 40 }}>
          <XAxis type="number" tickFormatter={(v: number) => `$${v.toFixed(2)}`} />
          <YAxis type="category" dataKey="title" width={100} />
          <Tooltip formatter={(v) => `$${Number(v).toFixed(2)}`} />
          <Bar dataKey="cost">
            {data.map((d) => <Cell key={d.feed_id} fill={d.color} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
