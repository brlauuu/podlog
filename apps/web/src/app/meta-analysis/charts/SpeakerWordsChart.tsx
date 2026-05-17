"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Data, Layout } from "plotly.js";
import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";
import PlotlyChart from "./PlotlyChart";
import { buildSpeakerSeries, type Source } from "./transforms/speakerRows";
import { feedShort, HOST_PALETTE, GUEST_PALETTE } from "./transforms/feedShort";

interface Props {
  rows: PerEpisodeSpeaker[];
  source: Source;
  enableClickOpen?: boolean;
}

export default function SpeakerWordsChart({ rows, source, enableClickOpen = true }: Props) {
  const router = useRouter();
  const series = useMemo(
    () => buildSpeakerSeries(rows, "words", source),
    [rows, source],
  );
  const sourceLabel = source === "confirmed" ? "Confirmed" : "Inferred — HIGH";

  if (series.size === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No data for {sourceLabel} source.
      </p>
    );
  }

  const feedIds = Array.from(series.keys());
  const traces: Data[] = [];

  feedIds.forEach((feedId) => {
    const fs = series.get(feedId)!;
    fs.hosts.forEach((h, hIdx) => {
      const color = HOST_PALETTE[hIdx % HOST_PALETTE.length];
      const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: `${h.display_name} (host)`,
        x: h.points.map((p) => p.published_at),
        y: h.points.map((p) => p.value),
        line: { width: 2, color },
        marker: { size: 7, symbol: "circle", color },
        customdata: h.points.map((p) => [p.episode_title, p.episode_id]),
        hovertemplate:
          "%{x|%Y-%m-%d}<br>%{y:,.0f} words<br>%{customdata[0]}" +
          clickHint +
          `<extra><b>${h.display_name}</b> (host)</extra>`,
        visible: true,
      });
    });
    if (fs.combinedGuests.length > 0) {
      const color = GUEST_PALETTE[0];
      const clickHint = enableClickOpen ? "<br><i>(click to open episode)</i>" : "";
      traces.push({
        type: "scatter",
        mode: "lines+markers",
        name: "Guests (combined)",
        x: fs.combinedGuests.map((p) => p.published_at),
        y: fs.combinedGuests.map((p) => p.value),
        line: { width: 1, color, dash: "dash" },
        marker: { size: 6, symbol: "diamond", color },
        customdata: fs.combinedGuests.map((p) => [
          p.episode_title,
          p.guest_count,
          p.guest_names.join(", "),
          p.episode_id,
        ]),
        hovertemplate:
          "%{x|%Y-%m-%d}<br>%{y:,.0f} words total<br>" +
          "%{customdata[1]} guest(s): %{customdata[2]}<br>%{customdata[0]}" +
          clickHint +
          "<extra><b>Guests</b> (combined)</extra>",
        visible: true,
      });
    }
  });

  const feedTitleText =
    feedIds.length === 1 ? feedShort(series.get(feedIds[0])!.feed_title) : "All podcasts";
  const hostsLabel =
    feedIds
      .flatMap((fid) => series.get(fid)!.hosts.map((h) => h.display_name))
      .join(", ") || "(none detected)";

  const layout: Partial<Layout> = {
    title: {
      text:
        `Per-speaker word count per episode — ${feedTitleText} ` +
        `<i>(${sourceLabel})</i><br><sub>Detected hosts: ${hostsLabel}</sub>`,
    },
    hovermode: "x unified",
    legend: { orientation: "h", yanchor: "top", y: -0.2, xanchor: "center", x: 0.5 },
    margin: { l: 60, r: 20, t: 70, b: 160 },
    xaxis: {
      showspikes: true,
      spikemode: "across",
      spikesnap: "cursor",
      spikedash: "dot",
      spikethickness: 1,
    },
    yaxis: { tickformat: ",.0f" },
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
