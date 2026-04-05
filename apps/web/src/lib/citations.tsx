import Link from "next/link";
import { formatTimestamp } from "@/lib/timestamp";

export interface Source {
  chunk_id: number;
  episode_id: string;
  episode_title: string;
  speaker_label: string | null;
  start_time: number;
  end_time: number;
  timestamp: string;
  text: string;
  similarity: number;
}

/**
 * Parse citation patterns like [Episode Title, 12:34] in the answer text
 * and return React nodes with clickable links.
 */
export function renderAnswerWithCitations(
  text: string,
  sources: Source[]
): React.ReactNode[] {
  // Match [anything, M:SS] or [anything, MM:SS]
  const citationRegex = /\[([^\]]+?),\s*(\d{1,3}:\d{2})\]/g;

  const nodes: React.ReactNode[] = [];
  let lastIndex = 0;
  let match;

  while ((match = citationRegex.exec(text)) !== null) {
    // Add text before this citation
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }

    const citedTitle = match[1].trim();
    const citedTimestamp = match[2];
    const [minStr, secStr] = citedTimestamp.split(":");
    const citedSeconds = parseInt(minStr) * 60 + parseInt(secStr);

    // Find matching source by title similarity
    const matchedSource = sources.find(
      (s) =>
        s.episode_title.toLowerCase().includes(citedTitle.toLowerCase()) ||
        citedTitle.toLowerCase().includes(s.episode_title.toLowerCase())
    );

    if (matchedSource) {
      nodes.push(
        <Link
          key={`cite-${match.index}`}
          href={`/episodes/${matchedSource.episode_id}?t=${citedSeconds}`}
          className="inline-flex items-center gap-0.5 text-primary hover:underline font-medium"
          title={`${matchedSource.episode_title} at ${citedTimestamp}`}
        >
          [{citedTitle}, {citedTimestamp}]
        </Link>
      );
    } else {
      // No match found — render as styled but non-linked citation
      nodes.push(
        <span
          key={`cite-${match.index}`}
          className="text-muted-foreground font-medium"
        >
          [{citedTitle}, {citedTimestamp}]
        </span>
      );
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }

  return nodes;
}

export { formatTimestamp };
