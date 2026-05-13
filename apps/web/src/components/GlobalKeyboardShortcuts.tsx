"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";
import { useKeyboardShortcut } from "@/lib/useKeyboardShortcut";

/**
 * Page-agnostic keyboard shortcuts (#702).
 *
 * Currently:
 *   - `/` focuses the first input marked `data-shortcut="search-input"`.
 *     If no such input is on the page (e.g. /podcasts), navigate to /search.
 *
 * Per-page shortcuts (J/K for episode prev/next, Space for player) live
 * with the components that own the relevant state.
 */
export default function GlobalKeyboardShortcuts() {
  const router = useRouter();

  const focusSearch = useCallback(
    (event: KeyboardEvent) => {
      // Stop the "/" from being typed into the field once we focus it.
      event.preventDefault();
      const input = document.querySelector<HTMLInputElement>(
        'input[data-shortcut="search-input"]',
      );
      if (input) {
        input.focus();
        input.select();
        return;
      }
      router.push("/search");
    },
    [router],
  );

  useKeyboardShortcut({ key: "/", handler: focusSearch });

  return null;
}
