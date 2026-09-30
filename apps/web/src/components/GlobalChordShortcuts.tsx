"use client";

import { useRouter } from "next/navigation";
import { useMemo } from "react";
import { useChordShortcut } from "@/lib/useChordShortcut";
import { confirmLeave } from "@/lib/leaveGuard";

/**
 * Two-key navigation chords (#704): press ``G``, then within ~1s a
 * destination key to jump to that page. Mirrors Gmail / GitHub style.
 *
 * Registered once at the layout level alongside other global shortcuts
 * so the chord works on every page.
 */
export default function GlobalChordShortcuts() {
  const router = useRouter();

  const map = useMemo(() => {
    // A page with unsaved changes gets to object first (#1069).
    const go = (path: string) => () => {
      if (confirmLeave(path)) router.push(path);
    };
    return {
      h: go("/"),
      q: go("/queue"),
      f: go("/feeds"),
      p: go("/podcasts"),
      a: go("/ask"),
      m: go("/meta-analysis"),
      s: go("/search"),
      t: go("/settings"),
      d: go("/docs"),
    };
  }, [router]);

  useChordShortcut({ prefix: "g", map });

  return null;
}
