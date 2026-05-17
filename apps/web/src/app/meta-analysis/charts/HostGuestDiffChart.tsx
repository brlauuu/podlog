"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Data, Layout } from "plotly.js";
import type { EpisodeSpeakerDiff } from "@/lib/metaAnalysisTypes";
import PlotlyChart from "./PlotlyChart";
import { filterDiffRows, summarizeDiff } from "./transforms/diffRows";
import type { Source } from "./transforms/speakerRows";
import { feedShort, PALETTE, hexToRgba } from "./transforms/feedShort";

interface Props {
  rows: EpisodeSpeakerDiff[];
  source: Source;
  enableClickOpen?: boolean;
}

export default function HostGuestDiffChart({ rows, source, enableClickOpen = true }: Props) {
  const router = useRouter();
  const filtered = useMemo(() => filterDiffRows(rows, source), [rows, source]);
  const sourceLabel = source === "confirmed" ? "Confirmed" : "Inferred — HIGH";

  if (filtered.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No episodes with both hosts and guests for {sourceLabel} source.
      </p>
    );
  }

  // Group by feed (deterministic by feed_title).
  const byFeed = new Map<string, EpisodeSpeakerDiff[]>();
  for (const r of filtered) {
    if (!byFeed.has(r.feed_id)) byFeed.set(r.feed_id, []);
    byFeed.get(r.feed_id)!.push(r);
  }
  const feedIds = Array.from(byFeed.keys());

  const traces: Data[] = [];
  const traceFeed: string[] = [];

  feedIds.forEach((fid, fIdx) => {
    const sub = byFeed.get(fid)!;
    const color = PALETTE[fIdx % PALETTE.length];
    const fill = hexToRgba(color, 0.18);

    // Upper-band line (invisible).
    traces.push({
      type: "scatter",
      mode: "lines",
      x: sub.map((r) => r.published_at),
      y: sub.map((r) => r.band_hi),
      line: { width: 0 },
      hoverinfo: "skip",
      showlegend: false,
      visible: fIdx === 0,
    });
    traceFeed.push(fid);

    // Lower-band line with fill.
    traces.push({
      type: "scatter",
      mode: "lines",
      x: sub.map((r) => r.published_at),
      y: sub.map((r) => r.band_lo),
      line: { width: 0 },
      fill: "tonexty",
      fillcolor: fill,
      hoverinfo: "skip",
      showlegend: false,
      visible: fIdx === 0,
    });
    traceFeed.push(fid);

    // Center line — signed diff per episode.
    const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
    traces.push({
      type: "scatter",
      mode: "lines+markers",
      name: `${feedShort(sub[0].feed_title)} (guest − host avg, min)`,
      x: sub.map((r) => r.published_at),
      y: sub.map((r) => r.diff),
      line: { width: 2, color },
      marker: { size: 7, color },
      customdata: sub.map((r) => [
        r.episode_title,
        r.host_mean,
        r.host_count,
        r.guest_mean,
        r.guest_count,
        r.host_names.join(", "),
        r.guest_names.join(", "),
        r.episode_id,
      ]),
      hovertemplate:
        "%{x|%Y-%m-%d}<br>" +
        "Δ = %{y:+.1f} min  (guest − host avg)<br>" +
        "Hosts (%{customdata[2]}, avg %{customdata[1]:.1f} min): %{customdata[5]}<br>" +
        "Guests (%{customdata[4]}, avg %{customdata[3]:.1f} min): %{customdata[6]}<br>" +
        "%{customdata[0]}" +
        clickHint +
        `<extra>${feedShort(sub[0].feed_title)}</extra>`,
      visible: fIdx === 0,
    });
    traceFeed.push(fid);
  });

  const buttons = feedIds.map((fid) => {
    const sub = byFeed.get(fid)!;
    const s = summarizeDiff(sub);
    const subtitle = `${s.total} episode(s) compared — guests talked more in ${s.guestsMore}, hosts in ${s.hostsMore}`;
    return {
      method: "update" as const,
      label: feedShort(sub[0].feed_title),
      args: [
        { visible: traceFeed.map((tf) => tf === fid) },
        {
          title: {
            text:
              `Host vs Guest talking time per episode — ${feedShort(sub[0].feed_title)} ` +
              `<i>(${sourceLabel})</i><br><sub>${subtitle}</sub>`,
          },
        },
      ],
    };
  });

  const initial = byFeed.get(feedIds[0])!;
  const initSummary = summarizeDiff(initial);

  const layout: Partial<Layout> = {
    title: {
      text:
        `Host vs Guest talking time per episode — ${feedShort(initial[0].feed_title)} ` +
        `<i>(${sourceLabel})</i><br><sub>${initSummary.total} episode(s) compared — ` +
        `guests talked more in ${initSummary.guestsMore}, hosts in ${initSummary.hostsMore}</sub>`,
    },
    hovermode: "x unified",
    legend: { orientation: "h", yanchor: "top", y: -0.2, xanchor: "center", x: 0.5 },
    margin: { l: 60, r: 20, t: 110, b: 160 },
    xaxis: {
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
      spikedash: "dot",
      spikethickness: 1,
    },
    yaxis: {
      title: { text: "Δ minutes (guest avg − host avg)" },
      ticksuffix: " min",
      zeroline: false,
    },
    shapes: [{
      type: "line",
      xref: "paper",
      x0: 0,
      x1: 1,
      y0: 0,
      y1: 0,
      line: { color: "#888", width: 1, dash: "dot" },
    }],
    updatemenus: [{
      type: "dropdown",
      buttons,
      direction: "down",
      x: 0,
      y: 1.18,
      xanchor: "left",
      yanchor: "top",
    }],
  };

  return (
    <PlotlyChart
      data={traces}
      layout={layout}
      height={420}
      onPointClick={enableClickOpen ? (epId) => router.push(`/episodes/${epId}`) : undefined}
    />
  );
}
