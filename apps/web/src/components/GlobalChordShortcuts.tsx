"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useChordShortcut } from "@/lib/useChordShortcut";

/**
 * Two-key navigation chords (#704): press ``G``, then within ~1s a
 * destination key to jump to that page. Mirrors Gmail / GitHub style.
 *
 * Registered once at the layout level alongside other global shortcuts
 * so the chord works on every page.
 */
export default function GlobalChordShortcuts() {
  const router = useRouter();

  const map = useMemo(
    () => ({
      h: () => router.push("/"),
      q: () => router.push("/queue"),
      f: () => router.push("/feeds"),
      p: () => router.push("/podcasts"),
      a: () => router.push("/ask"),
      m: () => router.push("/meta-analysis"),
      s: () => router.push("/settings"),
      d: () => router.push("/docs"),
    }),
    [router],
  );

  useChordShortcut({ prefix: "g", map });

  return null;
}
