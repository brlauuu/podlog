"use client";

import { useState, useMemo, useCallback, useRef } from "react";
import DOMPurify from "isomorphic-dompurify";
import path from "path";
import { useAudioPlayer } from "@/components/AudioPlayerContext";

interface Props {
  description: string;
  episodeId?: string;
  audioLocalPath?: string | null;
  episodeTitle?: string | null;
  feedTitle?: string | null;
}

/**
 * Parse a timestamp string (HH:MM:SS or MM:SS) into total seconds.
 * Returns null if the format is invalid.
 */
function parseTimestamp(ts: string): number | null {
  const parts = ts.split(":").map(Number);
  if (parts.some(isNaN)) return null;
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (h < 0 || m < 0 || m > 59 || s < 0 || s > 59) return null;
    return h * 3600 + m * 60 + s;
  }
  if (parts.length === 2) {
    const [m, s] = parts;
    if (m < 0 || s < 0 || s > 59) return null;
    return m * 60 + s;
  }
  return null;
}

/**
 * Linkify timestamps in sanitized HTML. Only converts timestamps that appear
 * in text content (not inside href attributes or existing anchor tags).
 *
 * The regex matches HH:MM:SS or MM:SS patterns that are NOT preceded by
 * characters that would indicate they're part of a URL or other non-timestamp
 * context (letters, digits, slashes, dots, equals, or quotes).
 */
function linkifyTimestamps(html: string): string {
  // Process the HTML by splitting on tags so we only modify text nodes,
  // not attribute values or tag content.
  const tagRegex = /(<[^>]*>)/;
  const parts = html.split(tagRegex);
  let insideAnchor = 0;

  // Matches MM:SS or HH:MM:SS timestamps.
  // Negative lookbehind: must not be preceded by a word char, slash, dot,
  // equals, or quote (avoids matching inside URLs, attribute values, etc.)
  // Negative lookahead: must not be followed by a colon (avoids partial match
  // of longer colon-separated strings).
  const timestampRegex = /(?<![a-zA-Z0-9/.=:"'])(\d{1,2}:\d{2}:\d{2}|\d{1,3}:\d{2})(?![:0-9])/g;

  return parts
    .map((part) => {
      // If this is a tag, track anchor nesting
      if (part.startsWith("<")) {
        if (/^<a[\s>]/i.test(part)) insideAnchor++;
        if (/^<\/a>/i.test(part)) insideAnchor = Math.max(0, insideAnchor - 1);
        return part;
      }
      // Text node: skip if inside an anchor
      if (insideAnchor > 0) return part;

      return part.replace(timestampRegex, (match, timestamp: string) => {
        const secs = parseTimestamp(timestamp);
        if (secs === null) return match;
        return `<a href="#" data-timestamp-secs="${secs}" class="podlog-timestamp-link">${timestamp}</a>`;
      });
    })
    .join("");
}

export default function EpisodeDescription({
  description,
  episodeId,
  audioLocalPath,
  episodeTitle,
  feedTitle,
}: Props) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > 300;
  const containerRef = useRef<HTMLDivElement>(null);
  const { playEpisode } = useAudioPlayer();

  const sanitizedHtml = useMemo(() => {
    const clean = DOMPurify.sanitize(description, {
      ALLOWED_TAGS: [
        "p", "br", "b", "strong", "i", "em", "u", "a", "ul", "ol", "li",
        "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre",
        "span", "div", "hr", "img", "sup", "sub",
      ],
      ALLOWED_ATTR: ["href", "target", "rel", "src", "alt", "title", "class"],
    });

    // Force all links to open in new tabs
    let result = clean.replace(
      /<a /g,
      '<a target="_blank" rel="noopener noreferrer" '
    );

    // Linkify timestamps after sanitization so injected markup is safe
    // (linkifyTimestamps only adds data attributes and known class names)
    if (episodeId && audioLocalPath) {
      result = linkifyTimestamps(result);
    }

    return result;
  }, [description, episodeId, audioLocalPath]);

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (
        target.tagName === "A" &&
        target.classList.contains("podlog-timestamp-link")
      ) {
        e.preventDefault();
        const secs = Number(target.getAttribute("data-timestamp-secs"));
        if (!isNaN(secs)) {
          // Play audio from this timestamp (or open player with "unavailable"
          // state when the episode has no audio_local_path).
          if (episodeId) {
            const filename = audioLocalPath ? path.basename(audioLocalPath) : null;
            playEpisode(
              episodeId,
              filename,
              secs,
              episodeTitle ?? undefined,
              feedTitle ?? undefined,
            );
          }
          // Scroll transcript to this timestamp
          window.dispatchEvent(
            new CustomEvent("podlog:scroll-to-time", { detail: { secs } }),
          );
        }
      }
    },
    [episodeId, audioLocalPath, episodeTitle, feedTitle, playEpisode],
  );

  return (
    <div className="text-sm text-muted-foreground">
      <div
        ref={containerRef}
        onClick={handleClick}
        className={`prose prose-sm dark:prose-invert max-w-none prose-a:text-link prose-a:underline ${
          !expanded && isLong ? "line-clamp-3" : ""
        }`}
        dangerouslySetInnerHTML={{ __html: sanitizedHtml }}
      />
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-foreground hover:underline mt-1"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      )}
    </div>
  );
}
