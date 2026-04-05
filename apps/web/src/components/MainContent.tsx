"use client";

import { useAudioPlayer } from "@/components/AudioPlayerContext";

export default function MainContent({ children }: { children: React.ReactNode }) {
  const { state } = useAudioPlayer();
  const hasPlayer = Boolean(state.src);

  return (
    <main className={`max-w-5xl mx-auto px-4 py-8 flex-1 w-full ${hasPlayer ? "pb-24" : ""}`}>
      {children}
    </main>
  );
}
