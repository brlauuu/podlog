"use client";

import { AlertTriangle, Play } from "lucide-react";
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
 * Diarization warning badge if has_diarization = false.
 * "Play locally" button if audio_local_path is set.
 */
export default function SearchResult({ result }: Props) {
  const { playEpisode } = useAudioPlayer();

  const remoteUrl = buildTimestampUrl(
    { id: result.episodeId, audioUrl: result.audioUrl, audioLocalPath: result.audioLocalPath },
    result.startTime
  );

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
          {result.audioLocalPath && (
            <button
              onClick={handlePlayLocally}
              className="inline-flex items-center gap-1 text-xs bg-primary text-primary-foreground px-2 py-1 rounded hover:opacity-90 transition-opacity"
            >
              <Play size={11} />
              Play
            </button>
          )}
          <a
            href={remoteUrl}
            target="_blank"
            rel="noopener noreferrer"
            title="Opens in browser audio player. May not seek in all podcast apps."
            className="text-xs text-primary underline"
          >
            {formatTimestamp(result.startTime)}
          </a>
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
