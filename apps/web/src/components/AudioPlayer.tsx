"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2 } from "lucide-react";
import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { formatTimestamp } from "@/lib/timestamp";

/**
 * Global persistent audio player bar — fixed to bottom of screen.
 * Persists across page navigation via React context (PRD-02 §5.7).
 */
export default function AudioPlayer() {
  const { state, audioRef, togglePlayPause } = useAudioPlayer();
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [collapsed, setCollapsed] = useState(false);

  // Seek to startTime whenever a new episode is loaded
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !state.src) return;

    const onLoadedMetadata = () => {
      if (state.startTime > 0) {
        audio.currentTime = state.startTime;
      }
      audio.play().catch(() => {});
    };

    audio.src = state.src;
    audio.addEventListener("loadedmetadata", onLoadedMetadata, { once: true });
    audio.load();

    return () => audio.removeEventListener("loadedmetadata", onLoadedMetadata);
  }, [state.src, state.startTime]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const onTimeUpdate = () => setCurrentTime(audio.currentTime);
    const onDurationChange = () => setDuration(audio.duration || 0);

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("durationchange", onDurationChange);
    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("durationchange", onDurationChange);
    };
  }, []);

  if (!state.src) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50">
      <audio ref={audioRef} preload="metadata" />

      {collapsed ? (
        <div className="flex items-center gap-3 px-4 py-2">
          <button onClick={togglePlayPause} className="text-foreground hover:text-primary">
            {state.isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="text-sm truncate flex-1">{state.title}</span>
          <button onClick={() => setCollapsed(false)} className="text-xs text-muted-foreground">
            Expand
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4 px-4 py-3">
          <button onClick={togglePlayPause} className="text-foreground hover:text-primary shrink-0">
            {state.isPlaying ? <Pause size={20} /> : <Play size={20} />}
          </button>

          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{state.title}</div>
            {state.feedTitle && (
              <div className="text-xs text-muted-foreground truncate">{state.feedTitle}</div>
            )}
          </div>

          <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
            <span>{formatTimestamp(currentTime)}</span>
            <input
              type="range"
              min={0}
              max={duration || 1}
              value={currentTime}
              onChange={(e) => {
                const audio = audioRef.current;
                if (audio) audio.currentTime = Number(e.target.value);
              }}
              className="w-32"
            />
            <span>{formatTimestamp(duration)}</span>
          </div>

          <Volume2 size={16} className="text-muted-foreground shrink-0" />

          <button
            onClick={() => setCollapsed(true)}
            className="text-xs text-muted-foreground shrink-0"
          >
            Collapse
          </button>
        </div>
      )}
    </div>
  );
}
