"use client";

import { useState, useMemo } from "react";
import DOMPurify from "isomorphic-dompurify";

interface Props {
  description: string;
}

export default function EpisodeDescription({ description }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > 300;

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
    return clean.replace(
      /<a /g,
      '<a target="_blank" rel="noopener noreferrer" '
    );
  }, [description]);

  return (
    <div className="text-sm text-muted-foreground">
      <div
        className={`prose prose-sm dark:prose-invert max-w-none prose-a:text-primary prose-a:underline ${
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
