"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useKeyboardShortcut } from "@/lib/useKeyboardShortcut";

interface Props {
  prevId: string | null;
  nextId: string | null;
}

/**
 * J / K shortcuts for prev/next episode navigation (#702). Mounted on the
 * episode page; the parent already computes the adjacent IDs server-side.
 * Renders nothing — pure side effects.
 */
export default function EpisodeKeyboardNav({ prevId, nextId }: Props) {
  const router = useRouter();

  const goNext = useCallback(() => {
    if (nextId) router.push(`/episodes/${nextId}`);
  }, [nextId, router]);

  const goPrev = useCallback(() => {
    if (prevId) router.push(`/episodes/${prevId}`);
  }, [prevId, router]);

  useKeyboardShortcut({ key: "j", handler: goNext, enabled: !!nextId });
  useKeyboardShortcut({ key: "k", handler: goPrev, enabled: !!prevId });

  return null;
}
