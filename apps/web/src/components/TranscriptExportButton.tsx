"use client";

import { Download } from "lucide-react";
import type { Segment } from "@/lib/types";
import { formatTimestamp } from "@/lib/timestamp";

interface Props {
  episodeTitle: string;
  feedTitle: string | null;
  publishedAt: string | null;
  durationSecs: number | null;
  description: string | null;
  feedUrl: string | null;
  feedWebsiteUrl: string | null;
  feedDescription: string | null;
  audioUrl: string | null;
  guid: string | null;
  segments: Segment[];
}


function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function sanitizeFilename(name: string): string {
  return name
    .replace(/[/\\:*?"<>|]/g, "")
    .replace(/\s+/g, "-")
    .toLowerCase()
    .slice(0, 100);
}

function buildExportText(props: Props): string {
  const lines: string[] = [];
  const sep = "=".repeat(60);

  // Podcast metadata
  lines.push(sep);
  lines.push("PODCAST METADATA");
  lines.push(sep);
  if (props.feedTitle) lines.push(`Podcast:      ${props.feedTitle}`);
  if (props.feedWebsiteUrl) lines.push(`Website:      ${props.feedWebsiteUrl}`);
  if (props.feedUrl) lines.push(`Feed URL:     ${props.feedUrl}`);
  if (props.feedDescription) lines.push(`Description:  ${props.feedDescription}`);
  lines.push("");

  // Episode metadata
  lines.push(sep);
  lines.push("EPISODE METADATA");
  lines.push(sep);
  lines.push(`Title:        ${props.episodeTitle}`);
  if (props.publishedAt) lines.push(`Published:    ${new Date(props.publishedAt).toLocaleDateString()}`);
  if (props.durationSecs) lines.push(`Duration:     ${formatDuration(props.durationSecs)}`);
  if (props.description) lines.push(`Description:  ${props.description}`);
  if (props.audioUrl) lines.push(`Audio URL:    ${props.audioUrl}`);
  if (props.guid) lines.push(`Episode GUID: ${props.guid}`);
  lines.push("");

  // Transcript
  lines.push(sep);
  lines.push("TRANSCRIPT");
  lines.push(sep);
  lines.push("");

  for (const seg of props.segments) {
    const ts = formatTimestamp(seg.start_time, { padHours: true });
    const speaker = seg.display_name || seg.speaker_label;
    if (speaker) {
      lines.push(`[${ts}] ${speaker}:`);
    } else {
      lines.push(`[${ts}]`);
    }
    lines.push(seg.text);
    lines.push("");
  }

  return lines.join("\n");
}

export default function TranscriptExportButton(props: Props) {
  function handleExport() {
    const text = buildExportText(props);
    const blob = new Blob([text], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${sanitizeFilename(props.episodeTitle)}_transcript.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  return (
    <button
      onClick={handleExport}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground border border-input rounded-md px-3 py-1.5 transition-colors"
      title="Export transcript as .txt"
    >
      <Download size={14} />
      Export
    </button>
  );
}
