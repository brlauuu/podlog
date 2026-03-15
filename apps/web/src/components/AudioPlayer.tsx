"use client";

import { useEffect, useRef, useState } from "react";
import { Play, Pause, Volume2, VolumeX, ChevronUp, ChevronDown, SkipBack, SkipForward } from "lucide-react";
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
  const [muted, setMuted] = useState(false);
  const progressRef = useRef<HTMLDivElement>(null);

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

  function handleSeek(e: React.MouseEvent<HTMLDivElement>) {
    const audio = audioRef.current;
    const bar = progressRef.current;
    if (!audio || !bar || !duration) return;
    const rect = bar.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    audio.currentTime = pct * duration;
  }

  function skip(seconds: number) {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = Math.max(0, Math.min(duration, audio.currentTime + seconds));
  }

  function toggleMute() {
    const audio = audioRef.current;
    if (!audio) return;
    audio.muted = !audio.muted;
    setMuted(audio.muted);
  }

  if (!state.src) return null;

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-card border-t border-border z-50 shadow-lg">
      <audio ref={audioRef} preload="metadata" />

      {/* Progress bar — always visible, clickable */}
      <div
        ref={progressRef}
        className="h-1 bg-muted cursor-pointer group"
        onClick={handleSeek}
      >
        <div
          className="h-full bg-primary transition-[width] duration-100 group-hover:h-1.5"
          style={{ width: `${progress}%` }}
        />
      </div>

      {collapsed ? (
        <div className="flex items-center gap-3 px-4 py-2">
          <button onClick={togglePlayPause} className="text-foreground hover:text-primary transition-colors">
            {state.isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <span className="text-sm truncate flex-1">{state.title}</span>
          <span className="text-xs text-muted-foreground tabular-nums">{formatTimestamp(currentTime)}</span>
          <button onClick={() => setCollapsed(false)} className="text-muted-foreground hover:text-foreground transition-colors">
            <ChevronUp size={16} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-4 px-4 py-3">
          {/* Track info */}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium truncate">{state.title}</div>
            {state.feedTitle && (
              <div className="text-xs text-muted-foreground truncate">{state.feedTitle}</div>
            )}
          </div>

          {/* Playback controls */}
          <div className="flex items-center gap-3 shrink-0">
            <button onClick={() => skip(-15)} className="text-muted-foreground hover:text-foreground transition-colors" title="Back 15s">
              <SkipBack size={16} />
            </button>
            <button
              onClick={togglePlayPause}
              className="h-9 w-9 flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
            >
              {state.isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
            </button>
            <button onClick={() => skip(30)} className="text-muted-foreground hover:text-foreground transition-colors" title="Forward 30s">
              <SkipForward size={16} />
            </button>
          </div>

          {/* Time + volume */}
          <div className="flex items-center gap-3 text-xs text-muted-foreground shrink-0 tabular-nums">
            <span>{formatTimestamp(currentTime)}</span>
            <span>/</span>
            <span>{formatTimestamp(duration)}</span>
          </div>

          <button onClick={toggleMute} className="text-muted-foreground hover:text-foreground transition-colors shrink-0">
            {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
          </button>

          <button
            onClick={() => setCollapsed(true)}
            className="text-muted-foreground hover:text-foreground transition-colors shrink-0"
          >
            <ChevronDown size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
