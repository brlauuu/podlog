"use client";

import React, { createContext, useContext, useRef, useState } from "react";

interface PlayerState {
  episodeId: string | null;
  filename: string | null;
  src: string | null;
  startTime: number;
  title: string | null;
  feedTitle: string | null;
  isPlaying: boolean;
}

interface AudioPlayerContextValue {
  state: PlayerState;
  audioRef: React.RefObject<HTMLAudioElement | null>;
  playEpisode: (
    episodeId: string,
    filename: string | null,
    startTimeSecs: number,
    title?: string,
    feedTitle?: string
  ) => void;
  togglePlayPause: () => void;
  closePlayer: () => void;
}

const AudioPlayerContext = createContext<AudioPlayerContextValue | null>(null);

export function AudioPlayerProvider({ children }: { children: React.ReactNode }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [state, setState] = useState<PlayerState>({
    episodeId: null,
    filename: null,
    src: null,
    startTime: 0,
    title: null,
    feedTitle: null,
    isPlaying: false,
  });

  function playEpisode(
    episodeId: string,
    filename: string | null,
    startTimeSecs: number,
    title?: string,
    feedTitle?: string
  ) {
    const src = filename
      ? `/api/audio/${episodeId}/${encodeURIComponent(filename)}`
      : null;
    setState({
      episodeId,
      filename: filename || null,
      src,
      startTime: startTimeSecs,
      title: title ?? null,
      feedTitle: feedTitle ?? null,
      isPlaying: !!src,
    });
  }

  function togglePlayPause() {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play();
      setState((s) => ({ ...s, isPlaying: true }));
    } else {
      audio.pause();
      setState((s) => ({ ...s, isPlaying: false }));
    }
  }

  function closePlayer() {
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    setState({
      episodeId: null,
      filename: null,
      src: null,
      startTime: 0,
      title: null,
      feedTitle: null,
      isPlaying: false,
    });
  }

  return (
    <AudioPlayerContext.Provider value={{ state, audioRef, playEpisode, togglePlayPause, closePlayer }}>
      {children}
    </AudioPlayerContext.Provider>
  );
}

export function useAudioPlayer(): AudioPlayerContextValue {
  const ctx = useContext(AudioPlayerContext);
  if (!ctx) throw new Error("useAudioPlayer must be used within AudioPlayerProvider");
  return ctx;
}
