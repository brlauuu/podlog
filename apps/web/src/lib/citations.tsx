import Link from "next/link";
import { useMemo } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import { episodeTimestampHref } from "@/lib/episode-link";

export interface Source {
  chunk_id: number;
  episode_id: string;
  episode_title: string;
  audio_local_path?: string | null;
  speaker_label: string | null;
  start_time: number;
  end_time: number;
  timestamp: string;
  text: string;
  similarity: number;
}

/**
 * Callback for handling citation clicks in-place (e.g. scroll transcript)
 * instead of navigating. When provided, citations render as buttons.
 */
export type OnCitationClick = (episodeId: string, seconds: number) => void;

// Matches [anything, M:SS] or [anything, MM:SS]
const CITATION_REGEX = /\[([^\]]+?),\s*(\d{1,3}:\d{2})\]/g;

/**
 * Convert citation patterns like [Episode Title, 12:34] into Markdown links
 * using a podlog-cite:// URL scheme that MarkdownAnswer's link renderer resolves.
 * Unmatched citations are bolded but unlinked.
 */
export function preprocessCitations(text: string, sources: Source[]): string {
  return text.replace(CITATION_REGEX, (_, title: string, timestamp: string) => {
    const [minStr, secStr] = timestamp.split(":");
    const seconds = parseInt(minStr) * 60 + parseInt(secStr);
    const matched = sources.find(
      (s) =>
        s.episode_title.toLowerCase().includes(title.toLowerCase()) ||
        title.toLowerCase().includes(s.episode_title.toLowerCase())
    );
    if (matched) {
      return `[${title}, ${timestamp}](podlog-cite://${matched.episode_id}/${seconds})`;
    }
    return `**[${title}, ${timestamp}]**`;
  });
}

// react-markdown's defaultUrlTransform strips non-standard schemes. Pass
// podlog-cite:// through so citation links reach the custom a component intact.
function urlTransform(url: string): string {
  if (url.startsWith("podlog-cite://")) return url;
  return defaultUrlTransform(url);
}

/**
 * Renders an LLM answer as Markdown, with [Episode Title, M:SS] citation
 * patterns resolved to clickable episode-timestamp links.
 */
export function MarkdownAnswer({
  text,
  sources,
  onCitationClick,
  className,
}: {
  text: string;
  sources: Source[];
  onCitationClick?: OnCitationClick;
  className?: string;
}) {
  const processed = useMemo(() => preprocessCitations(text, sources), [text, sources]);

  return (
    <div className={className}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        urlTransform={urlTransform}
        components={{
          a({ href, children }) {
            if (href?.startsWith("podlog-cite://")) {
              const rest = href.slice("podlog-cite://".length);
              const slash = rest.indexOf("/");
              const episodeId = rest.slice(0, slash);
              const seconds = parseInt(rest.slice(slash + 1));
              const title = typeof children === "string" ? children : undefined;
              if (onCitationClick) {
                return (
                  <button
                    type="button"
                    title={title}
                    onClick={() => onCitationClick(episodeId, seconds)}
                    className="inline-flex items-center gap-0.5 text-link hover:underline font-medium"
                  >
                    {children}
                  </button>
                );
              }
              return (
                <Link
                  href={episodeTimestampHref(episodeId, seconds)}
                  title={title}
                  className="inline-flex items-center gap-0.5 text-link hover:underline font-medium"
                >
                  {children}
                </Link>
              );
            }
            return (
              <a href={href} target="_blank" rel="noopener noreferrer" className="text-link hover:underline">
                {children}
              </a>
            );
          },
        }}
      >
        {processed}
      </ReactMarkdown>
    </div>
  );
}
