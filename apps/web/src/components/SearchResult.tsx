"use client";

import { AlertTriangle, ExternalLink, Play } from "lucide-react";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { buildTimestampUrl, formatTimestamp } from "@/lib/timestamp";
import type { SearchResult as SearchResultType } from "@/lib/search";
import path from "path";

interface Props {
  result: SearchResultType;
}

/**
 * Search result card — PRD-02 §9.1
 *
 * Shows: episode title, podcast name, speaker, timestamp, highlighted snippet.
 * Primary action: open external link (episode page or remote audio URL).
 * Secondary: embedded player fallback if local audio exists and no remote URL.
 */
export default function SearchResult({ result }: Props) {
  const { playEpisode } = useAudioPlayer();

  const externalUrl = buildTimestampUrl(
    {
      id: result.episodeId,
      audioUrl: result.audioUrl,
      audioLocalPath: result.audioLocalPath,
      episodeUrl: result.episodeUrl,
    },
    result.startTime
  );

  const hasLocalAudio = !!result.audioLocalPath;
  const hasExternalLink = !!result.episodeUrl || !!result.audioUrl;

  function handlePlayLocally() {
    if (!result.audioLocalPath) return;
    const safeName = path.basename(result.audioLocalPath);
    playEpisode(
      result.episodeId,
      safeName,
      result.startTime,
      result.episodeTitle ?? undefined,
      result.feedTitle ?? undefined
    );
  }

  return (
    <div className="border border-border rounded-lg p-4 space-y-2 hover:bg-accent/30 transition-colors">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium truncate">
              {result.feedTitle}
            </span>
            {result.episodeTitle && (
              <>
                <span className="text-muted-foreground">·</span>
                <span className="text-sm text-muted-foreground truncate">
                  {result.episodeTitle}
                </span>
              </>
            )}
            {!result.hasDiarization && (
              <span className="inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 px-1.5 py-0.5 rounded">
                <AlertTriangle size={11} />
                No labels
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-0.5">
            {result.speakerDisplay
              ? `${result.speakerDisplay} · ${formatTimestamp(result.startTime)}`
              : formatTimestamp(result.startTime)}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {hasExternalLink && (
            <a
              href={externalUrl}
              target="_blank"
              rel="noopener noreferrer"
              title={result.episodeUrl ? "Open episode page" : "Open audio in browser"}
              className="inline-flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 transition-opacity"
            >
              <ExternalLink size={11} />
              {formatTimestamp(result.startTime)}
            </a>
          )}
          {hasLocalAudio && (
            <button
              onClick={handlePlayLocally}
              title="Play in embedded player"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground border border-input px-2 py-1 rounded transition-colors"
            >
              <Play size={11} />
            </button>
          )}
        </div>
      </div>

      {/* Snippet — rendered HTML from ts_headline (contains <b> tags) */}
      <p
        className="text-sm leading-relaxed [&_b]:font-semibold [&_b]:text-foreground text-muted-foreground"
        dangerouslySetInnerHTML={{ __html: result.snippet }}
      />
    </div>
  );
}
