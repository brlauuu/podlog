"use client";

import { useEffect, useState } from "react";

export interface ChangelogTocItem {
  /** Slugified id matching the heading's `id` attribute on the page. */
  id: string;
  /** Section label, e.g. `[0.3.0] — 2026-04-24` or `[Unreleased]`. */
  text: string;
}

interface Props {
  items: ChangelogTocItem[];
}

export default function ChangelogToc({ items }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  // Scroll-spy: highlight the version closest to the top of the viewport.
  // Mirrors the docs page's right-rail behavior.
  useEffect(() => {
    if (!items.length) return;

    const updateActive = () => {
      const topOffset = 120;
      let active = items[0]?.id ?? null;
      for (const item of items) {
        const el = document.getElementById(item.id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - topOffset <= 0) {
          active = item.id;
        } else {
          break;
        }
      }
      setActiveId(active);
    };

    updateActive();
    window.addEventListener("scroll", updateActive, { passive: true });
    window.addEventListener("resize", updateActive);
    return () => {
      window.removeEventListener("scroll", updateActive);
      window.removeEventListener("resize", updateActive);
    };
  }, [items]);

  if (items.length === 0) return null;

  // The first non-Unreleased item, by convention, is the latest tagged release.
  const latest = items.find((item) => !item.text.toLowerCase().includes("unreleased"));

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-20">
        <h2 className="mb-1 text-sm font-semibold text-muted-foreground">Releases</h2>
        <p className="mb-2 text-xs text-muted-foreground">
          {items.length} {items.length === 1 ? "version" : "versions"}
          {latest ? ` · latest ${stripDate(latest.text)}` : ""}
        </p>
        <nav className="space-y-1">
          {items.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              className={`block text-sm transition-colors hover:text-foreground ${
                activeId === item.id
                  ? "font-medium text-foreground"
                  : "text-muted-foreground"
              }`}
            >
              {item.text}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}

/**
 * `[0.3.0] — 2026-04-24` → `[0.3.0]`. Used in the "latest …" hint where the
 * date would be redundant noise next to the version number.
 */
function stripDate(text: string): string {
  return text.replace(/\s*[—–-]\s*\d{4}-\d{2}-\d{2}.*$/, "").trim();
}
