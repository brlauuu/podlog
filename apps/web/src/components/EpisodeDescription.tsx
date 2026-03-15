"use client";

import { useState } from "react";

interface Props {
  description: string;
}

export default function EpisodeDescription({ description }: Props) {
  const [expanded, setExpanded] = useState(false);
  const isLong = description.length > 300;

  return (
    <div className="text-sm text-muted-foreground">
      <p className={!expanded && isLong ? "line-clamp-3" : ""} style={{ whiteSpace: "pre-line" }}>
        {description}
      </p>
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
