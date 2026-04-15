"use client";

import { useAudioPlayer } from "@/components/AudioPlayerContext";
import { usePathname } from "next/navigation";

export default function MainContent({ children }: { children: React.ReactNode }) {
  const { state } = useAudioPlayer();
  const pathname = usePathname();
  const hasPlayer = Boolean(state.src);
  const isHome = pathname === "/";

  return (
    <main
      className={`max-w-5xl mx-auto px-4 py-8 flex-1 w-full ${isHome ? "flex flex-col" : ""} ${hasPlayer ? "pb-24" : ""}`}
    >
      {children}
    </main>
  );
}
