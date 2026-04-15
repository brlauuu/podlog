"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useAudioPlayer } from "@/components/AudioPlayerContext";

/**
 * Renders a "Back to search results" link when the episode page was reached
 * from a search result (indicated by the ?q= query parameter).
 */
export default function BackToSearchLink() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q");
  const { state: playerState } = useAudioPlayer();
  const playerVisible = !!playerState.src;

  if (!query) return null;

  return (
    <Link
      href={`/search?q=${encodeURIComponent(query)}`}
      className={`fixed left-6 z-[60] inline-flex items-center gap-2 rounded-full bg-action px-4 py-3 text-sm font-medium text-action-foreground shadow-lg hover:bg-action/90 transition-all ${
        playerVisible ? "bottom-24" : "bottom-6"
      }`}
    >
      <ArrowLeft size={14} />
      Back to search results
    </Link>
  );
}
