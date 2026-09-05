/**
 * Transcript export formatters (#1037).
 *
 * Moved out of TranscriptExportButton so the same text and Markdown output
 * can be served over HTTP by `app/api/episodes/[id]/transcript/route.ts`
 * (which the Telegram bot's /transcript command fetches) and downloaded in
 * the browser by the button. One implementation, two callers -- the route
 * test pins the output so the two cannot drift.
 */
import type { Segment } from "@/lib/types";
import { formatTimestamp } from "@/lib/timestamp";
import { formatDate } from "@/lib/dateFormat";
import { sanitizeFilename } from "@/lib/filename";

export interface TranscriptExportInput {
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

export type TranscriptExportFormat = "txt" | "md";

/** `<title>_transcript.<ext>`, the name the Export button has always used. */
export function transcriptExportFilename(
  episodeTitle: string,
  format: TranscriptExportFormat,
): string {
  return `${sanitizeFilename(episodeTitle)}_transcript.${format}`;
}

export function formatDuration(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export function buildExportText(props: TranscriptExportInput): string {
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
  if (props.publishedAt) lines.push(`Published:    ${formatDate(props.publishedAt)}`);
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

export function buildExportMarkdown(props: TranscriptExportInput): string {
  const lines: string[] = [];
  lines.push("# Transcript Export");
  lines.push("");
  if (props.feedTitle) lines.push(`**Podcast:** ${props.feedTitle}`);
  lines.push(`**Episode:** ${props.episodeTitle}`);
  if (props.publishedAt) lines.push(`**Published:** ${formatDate(props.publishedAt)}`);
  if (props.durationSecs) lines.push(`**Duration:** ${formatDuration(props.durationSecs)}`);
  if (props.audioUrl) lines.push(`**Audio URL:** ${props.audioUrl}`);
  if (props.guid) lines.push(`**Episode GUID:** ${props.guid}`);
  lines.push("");
  if (props.description) {
    lines.push("## Description");
    lines.push("");
    lines.push(props.description);
    lines.push("");
  }
  lines.push("## Transcript");
  lines.push("");

  for (const seg of props.segments) {
    const ts = formatTimestamp(seg.start_time, { padHours: true });
    const speaker = seg.display_name || seg.speaker_label;
    if (speaker) {
      lines.push(`- \`${ts}\` **${speaker}:** ${seg.text}`);
    } else {
      lines.push(`- \`${ts}\` ${seg.text}`);
    }
  }

  return lines.join("\n");
}
