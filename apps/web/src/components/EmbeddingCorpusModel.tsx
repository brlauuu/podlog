"use client";

import { useEffect, useState } from "react";

/**
 * Shows which model actually built the corpus, next to the Embedding step (#945).
 *
 * The point is to make the consequence of changing the embedding model visible
 * at the moment of choosing. Two 384-dimensional models produce completely
 * different vectors, so a swap is accepted silently by every other guard.
 */

type ModelState = {
  recorded_model: string | null;
  configured_model: string;
  matches: boolean;
  embedded_segments: number;
};

export function EmbeddingCorpusModel() {
  const [state, setState] = useState<ModelState | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pipeline/embed-model-state")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error("unavailable"))))
      .then((data) => {
        if (!cancelled) setState(data);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Silent when unavailable: this is supplementary context, and the Settings
  // page must stay usable with the pipeline down.
  if (failed || !state) return null;

  if (!state.recorded_model) {
    return (
      <p className="text-xs text-muted-foreground">
        No embeddings recorded yet — the first embed will adopt the selected model.
      </p>
    );
  }

  return (
    <div className="text-xs">
      <p className="text-muted-foreground">
        Corpus built with{" "}
        <code className="font-mono">{state.recorded_model}</code>
        {state.embedded_segments > 0 && (
          <> across {state.embedded_segments.toLocaleString()} segments.</>
        )}
      </p>
      {!state.matches && (
        <p className="mt-1 font-medium text-destructive">
          The configured model ({state.configured_model}) differs. Embedding is
          blocked until they agree, because the two produce incompatible vectors
          even at the same dimension. Change it back, or re-embed the corpus.
        </p>
      )}
    </div>
  );
}
