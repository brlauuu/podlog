"use client";

import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { buildTokensPerEpisode } from "./transforms/tokensPerEpisode";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

interface Props { episodes: PerEpisode[]; }

export default function TokensPerEpisode({ episodes }: Props) {
  const data = buildTokensPerEpisode(episodes);
  if (data.length === 0) {
    return <p className="text-sm text-muted-foreground">No dated episodes.</p>;
  }
  return (
    <div style={{ width: "100%", height: 220 }}>
      <ResponsiveContainer>
        <LineChart data={data}>
          <XAxis dataKey="published_at" tickFormatter={(s: string) => s.slice(0, 10)} />
          <YAxis />
          <Tooltip />
          <Legend />
          <Line type="monotone" dataKey="segments" stroke="#6366f1" name="Segments" dot={false} />
          <Line type="monotone" dataKey="chunks" stroke="#ec4899" name="Chunks"
            strokeDasharray="5 5" dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
