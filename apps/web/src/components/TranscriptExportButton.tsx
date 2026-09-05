"use client";

import { Download, FileText, Printer, Type } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { formatTimestamp } from "@/lib/timestamp";
import { formatDate } from "@/lib/dateFormat";
import {
  buildExportMarkdown,
  buildExportText,
  formatDuration,
  transcriptExportFilename,
  type TranscriptExportInput,
} from "@/lib/transcriptExport";

// The formatters live in lib/transcriptExport.ts (#1037) so the
// /api/episodes/[id]/transcript route serves the same bytes this button
// downloads.
type Props = TranscriptExportInput;


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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function openPrintView(props: Props) {
  const title = props.episodeTitle || "Transcript Export";
  const rows = props.segments
    .map((seg) => {
      const ts = formatTimestamp(seg.start_time, { padHours: true });
      const speaker = seg.display_name || seg.speaker_label;
      return `<p><span class="ts">[${escapeHtml(ts)}]</span> ${speaker ? `<strong>${escapeHtml(speaker)}:</strong> ` : ""}${escapeHtml(seg.text)}</p>`;
    })
    .join("\n");

  const html = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${escapeHtml(title)} - Transcript Export</title>
    <style>
      body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 24px; color: #111827; }
      h1, h2 { margin: 0 0 12px; }
      .meta { margin-bottom: 16px; font-size: 14px; color: #4b5563; }
      .meta div { margin: 2px 0; }
      .ts { color: #2563eb; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
      p { margin: 0 0 10px; line-height: 1.45; }
      @media print { body { margin: 0.5in; } }
    </style>
  </head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <div class="meta">
      ${props.feedTitle ? `<div><strong>Podcast:</strong> ${escapeHtml(props.feedTitle)}</div>` : ""}
      ${props.publishedAt ? `<div><strong>Published:</strong> ${escapeHtml(formatDate(props.publishedAt))}</div>` : ""}
      ${props.durationSecs ? `<div><strong>Duration:</strong> ${escapeHtml(formatDuration(props.durationSecs))}</div>` : ""}
    </div>
    <h2>Transcript</h2>
    ${rows}
  </body>
</html>`;

  const w = window.open("", "_blank");
  if (!w) return;
  w.document.open();
  w.document.write(html);
  w.document.close();
  w.focus();
  w.print();
}

export default function TranscriptExportButton(props: Props) {
  function handleExport(format: "markdown" | "text" | "print") {
    if (format === "markdown") {
      const content = buildExportMarkdown(props);
      downloadFile(
        content,
        transcriptExportFilename(props.episodeTitle, "md"),
        "text/markdown;charset=utf-8",
      );
      return;
    }

    if (format === "print") {
      openPrintView(props);
      return;
    }

    const text = buildExportText(props);
    downloadFile(
      text,
      transcriptExportFilename(props.episodeTitle, "txt"),
      "text/plain;charset=utf-8",
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="gap-1.5" title="Export transcript">
          <Download size={14} />
          Export
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onClick={() => handleExport("markdown")} className="gap-2">
          <FileText size={14} />
          <div>
            <div className="text-sm">Markdown (.md)</div>
            <div className="text-[11px] text-muted-foreground">Structured transcript + metadata</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("text")} className="gap-2">
          <Type size={14} />
          <div>
            <div className="text-sm">Plain Text (.txt)</div>
            <div className="text-[11px] text-muted-foreground">Simple format, no markup</div>
          </div>
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => handleExport("print")} className="gap-2">
          <Printer size={14} />
          <div>
            <div className="text-sm">Print / PDF</div>
            <div className="text-[11px] text-muted-foreground">Open printable transcript view</div>
          </div>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
