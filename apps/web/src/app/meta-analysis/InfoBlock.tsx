"use client";

import { useState } from "react";

export default function InfoBlock() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md p-3 text-sm bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2 text-left w-full font-medium"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        What are segments and chunks?
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            <strong>Segments</strong> are raw Whisper output — one row per
            utterance, usually a few seconds long.
          </p>
          <p>
            <strong>Chunks</strong> are merged same-speaker consecutive
            segments, combined into ~400-token groups. Speaker changes are
            chunk boundaries. This is what the RAG pipeline retrieves for
            the Ask AI feature.
          </p>
          <p>
            Token counts from both are shown because they tell slightly
            different stories: segment tokens include every utterance
            boundary, chunk tokens reflect how the retrieval system sees an
            episode.
          </p>
          <p className="text-xs">
            Estimated tokens — uses <code>cl100k_base</code> encoding;
            actual token counts vary by model.
          </p>
        </div>
      )}
    </div>
  );
}
