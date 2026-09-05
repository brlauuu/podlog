/**
 * Pins the transcript export formats (#1037). The Export button and the
 * /api/episodes/[id]/transcript route both produce these bytes; a change
 * here is a change users will see in downloaded files.
 */
import {
  buildExportMarkdown,
  buildExportText,
  transcriptExportFilename,
  type TranscriptExportInput,
} from "@/lib/transcriptExport";
import type { Segment } from "@/lib/types";

function seg(over: Partial<Segment> = {}): Segment {
  return {
    id: 1, start_time: 3725, end_time: 3730, speaker_label: "SPEAKER_00",
    display_name: "Alice", inferred: false, confirmed_by_user: true, role: "host",
    text: "Hello there.", ...over,
  };
}

const input: TranscriptExportInput = {
  episodeTitle: "Đorđe's Episode",
  feedTitle: "The Feed",
  publishedAt: "2026-01-02T00:00:00Z",
  durationSecs: 3900,
  description: "About things.",
  feedUrl: "https://example.com/feed.xml",
  feedWebsiteUrl: "https://example.com",
  feedDescription: "A feed.",
  audioUrl: "https://example.com/ep.mp3",
  guid: "guid-1",
  segments: [seg(), seg({ id: 2, start_time: 5, speaker_label: null, display_name: null, text: "No speaker." })],
};

describe("transcript export formatters", () => {
  it("text format: metadata blocks then timestamped speaker turns", () => {
    const out = buildExportText(input);
    expect(out).toContain("PODCAST METADATA");
    expect(out).toContain("Podcast:      The Feed");
    expect(out).toContain("Feed URL:     https://example.com/feed.xml");
    expect(out).toContain("Title:        Đorđe's Episode");
    expect(out).toContain("Duration:     1h 5m");
    expect(out).toContain("[01:02:05] Alice:\nHello there.");
    // Segment with no speaker: timestamp alone on its line.
    expect(out).toContain("[00:05]\nNo speaker.");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("markdown format: header, description section, bullet per segment", () => {
    const out = buildExportMarkdown(input);
    expect(out.startsWith("# Transcript Export\n")).toBe(true);
    expect(out).toContain("**Podcast:** The Feed");
    expect(out).toContain("## Description\n\nAbout things.");
    expect(out).toContain("- `01:02:05` **Alice:** Hello there.");
    expect(out).toContain("- `00:05` No speaker.");
  });

  it("omits optional metadata that is missing", () => {
    const sparse = { ...input, feedTitle: null, feedUrl: null, feedWebsiteUrl: null,
      feedDescription: null, description: null, audioUrl: null, guid: null, durationSecs: null,
      publishedAt: null };
    const txt = buildExportText(sparse);
    expect(txt).not.toContain("Podcast:");
    expect(txt).not.toContain("Duration:");
    const md = buildExportMarkdown(sparse);
    expect(md).not.toContain("## Description");
    expect(md).not.toContain("**Podcast:**");
  });

  it("filename keeps unicode letters and uses the historic suffix", () => {
    expect(transcriptExportFilename("Đorđe's Episode", "md")).toBe("Đorđe's-Episode_transcript.md");
    expect(transcriptExportFilename("a/b:c", "txt")).toBe("abc_transcript.txt");
  });
});
