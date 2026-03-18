"use client";

import { Download, FileText, FileJson, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { SearchResult, GroupedSearchResult } from "@/lib/search";

type ExportFormat = "csv" | "json" | "markdown";

interface DownloadReportButtonProps {
  query: string;
  viewMode: "flat" | "grouped";
  flatResults?: SearchResult[];
  groupedResults?: GroupedSearchResult;
}

/** Strip HTML tags from ts_headline snippets. */
function stripHtml(html: string): string {
  return html.replace(/<[^>]*>/g, "");
}

/** Format seconds as H:MM:SS or MM:SS. */
function fmtTime(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Escape a field for CSV: wrap in quotes if it contains comma, quote, or newline. */
function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function generateCsv(
  query: string,
  flatResults?: SearchResult[],
  groupedResults?: GroupedSearchResult,
): string {
  const rows: string[][] = [];
  const header = ["Podcast", "Episode", "Timestamp", "Speaker", "Snippet"];
  rows.push(header);

  if (flatResults && flatResults.length > 0) {
    for (const r of flatResults) {
      rows.push([
        r.feedTitle ?? "",
        r.episodeTitle ?? "",
        fmtTime(r.startTime),
        r.speakerDisplay ?? r.speakerLabel ?? "",
        stripHtml(r.snippet),
      ]);
    }
  } else if (groupedResults) {
    for (const feed of groupedResults.feeds) {
      for (const ep of feed.episodes) {
        rows.push([
          feed.feedTitle,
          ep.episodeTitle,
          "",
          "",
          `${ep.mentionCount} mention${ep.mentionCount !== 1 ? "s" : ""}`,
        ]);
      }
    }
  }

  return rows.map((row) => row.map(csvEscape).join(",")).join("\n");
}

function generateJson(
  query: string,
  flatResults?: SearchResult[],
  groupedResults?: GroupedSearchResult,
): string {
  const report: Record<string, unknown> = {
    query,
    exportedAt: new Date().toISOString(),
  };

  if (flatResults && flatResults.length > 0) {
    report.totalResults = flatResults.length;
    report.results = flatResults.map((r) => ({
      podcast: r.feedTitle,
      episode: r.episodeTitle,
      episodeId: r.episodeId,
      timestamp: fmtTime(r.startTime),
      startTime: r.startTime,
      endTime: r.endTime,
      speaker: r.speakerDisplay ?? r.speakerLabel ?? null,
      snippet: stripHtml(r.snippet),
    }));
  } else if (groupedResults) {
    report.totalFeeds = groupedResults.totalFeeds;
    report.totalEpisodes = groupedResults.totalEpisodes;
    report.totalMentions = groupedResults.totalMentions;
    report.feeds = groupedResults.feeds.map((feed) => ({
      feedTitle: feed.feedTitle,
      mentionCount: feed.mentionCount,
      episodes: feed.episodes.map((ep) => ({
        episodeTitle: ep.episodeTitle,
        episodeId: ep.episodeId,
        mentionCount: ep.mentionCount,
      })),
    }));
  }

  return JSON.stringify(report, null, 2);
}

function generateMarkdown(
  query: string,
  flatResults?: SearchResult[],
  groupedResults?: GroupedSearchResult,
): string {
  const lines: string[] = [];
  lines.push(`# Search Report`);
  lines.push("");
  lines.push(`**Query:** ${query}`);
  lines.push(`**Exported:** ${new Date().toISOString()}`);
  lines.push("");

  if (flatResults && flatResults.length > 0) {
    lines.push(`**Total results:** ${flatResults.length}`);
    lines.push("");

    // Group by episode for readability
    const byEpisode = new Map<string, SearchResult[]>();
    for (const r of flatResults) {
      const key = r.episodeId;
      if (!byEpisode.has(key)) byEpisode.set(key, []);
      byEpisode.get(key)!.push(r);
    }

    for (const results of Array.from(byEpisode.values())) {
      const first = results[0];
      lines.push(`## ${first.feedTitle ?? "Unknown Podcast"} - ${first.episodeTitle ?? "Unknown Episode"}`);
      lines.push("");
      for (const r of results) {
        const speaker = r.speakerDisplay ?? r.speakerLabel ?? "";
        const speakerPrefix = speaker ? `**${speaker}:** ` : "";
        lines.push(`- \`${fmtTime(r.startTime)}\` ${speakerPrefix}${stripHtml(r.snippet)}`);
      }
      lines.push("");
    }
  } else if (groupedResults) {
    lines.push(
      `**Found in** ${groupedResults.totalFeeds} podcast${groupedResults.totalFeeds !== 1 ? "s" : ""}, ` +
      `${groupedResults.totalEpisodes} episode${groupedResults.totalEpisodes !== 1 ? "s" : ""} ` +
      `(${groupedResults.totalMentions} mention${groupedResults.totalMentions !== 1 ? "s" : ""})`
    );
    lines.push("");

    for (const feed of groupedResults.feeds) {
      lines.push(`## ${feed.feedTitle}`);
      lines.push("");
      for (const ep of feed.episodes) {
        lines.push(`- **${ep.episodeTitle}** — ${ep.mentionCount} mention${ep.mentionCount !== 1 ? "s" : ""}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function sanitizeFilename(query: string): string {
  return query.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 50);
}

export default function DownloadReportButton({
  query,
  viewMode,
  flatResults,
  groupedResults,
}: DownloadReportButtonProps) {
  const hasResults =
    (flatResults && flatResults.length > 0) ||
    (groupedResults && groupedResults.feeds.length > 0);

  if (!hasResults) return null;

  function handleExport(format: ExportFormat) {
    const safeQuery = sanitizeFilename(query);
    const flat = viewMode === "flat" ? flatResults : undefined;
    const grouped = viewMode === "grouped" ? groupedResults : undefined;

    switch (format) {
      case "csv": {
        const content = generateCsv(query, flat, grouped);
        downloadFile(content, `podlog-search-${safeQuery}.csv`, "text/csv;charset=utf-8");
        break;
      }
      case "json": {
        const content = generateJson(query, flat, grouped);
        downloadFile(content, `podlog-search-${safeQuery}.json`, "application/json");
        break;
      }
      case "markdown": {
        const content = generateMarkdown(query, flat, grouped);
        downloadFile(content, `podlog-search-${safeQuery}.md`, "text/markdown;charset=utf-8");
        break;
      }
    }
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5">
          <Download size={14} />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={() => handleExport("csv")}>
          <FileSpreadsheet size={14} />
          CSV
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("json")}>
          <FileJson size={14} />
          JSON
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("markdown")}>
          <FileText size={14} />
          Markdown
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
