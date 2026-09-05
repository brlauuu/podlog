import { NextRequest, NextResponse } from "next/server";
import { getEpisode, getSegments } from "@/lib/episodeData";
import {
  buildExportMarkdown,
  buildExportText,
  transcriptExportFilename,
  type TranscriptExportFormat,
} from "@/lib/transcriptExport";

/**
 * GET /api/episodes/[id]/transcript?format=txt|md  (#1037)
 *
 * The transcript export the episode page's Export button builds in the
 * browser, served as a file. Same formatters, same filename. Consumed by
 * the pipeline's Telegram bot (`/transcript`), which forwards the bytes to
 * a chat as a document; usable directly with curl as well.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MIME: Record<TranscriptExportFormat, string> = {
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const format = (req.nextUrl.searchParams.get("format") ?? "txt") as TranscriptExportFormat;
  if (format !== "txt" && format !== "md") {
    return NextResponse.json({ error: "format must be txt or md" }, { status: 400 });
  }
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  const [episode, segments] = await Promise.all([getEpisode(id), getSegments(id)]);
  if (!episode) {
    return NextResponse.json({ error: "Episode not found" }, { status: 404 });
  }

  const input = {
    episodeTitle: episode.title ?? "Untitled Episode",
    feedTitle: episode.feed_title,
    publishedAt: episode.published_at,
    durationSecs: episode.duration_secs,
    description: episode.description,
    feedUrl: episode.feed_url,
    feedWebsiteUrl: episode.feed_website_url,
    feedDescription: episode.feed_description,
    audioUrl: episode.audio_url,
    guid: episode.guid,
    segments,
  };
  const body = format === "md" ? buildExportMarkdown(input) : buildExportText(input);
  const filename = transcriptExportFilename(input.episodeTitle, format);
  // RFC 5987 form carries the unicode name; the plain form is the ASCII
  // fallback for clients that ignore filename*.
  const ascii = filename.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": MIME[format],
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
      "Cache-Control": "no-store",
    },
  });
}
