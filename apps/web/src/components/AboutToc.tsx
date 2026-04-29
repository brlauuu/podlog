"use client";

import { useEffect, useState } from "react";

export interface AboutTocItem {
  /** Slugified id matching the heading's `id` attribute on the page. */
  id: string;
  /** Section label (already date-stripped for version entries). */
  text: string;
}

export interface AboutTocSection {
  id: string;
  label: string;
}

interface Props {
  /** Top-level "About" entry — anchored to the About section heading. */
  about: AboutTocSection;
  /** Top-level "Changelog" entry plus the nested version list. */
  changelog: AboutTocSection & { versions: AboutTocItem[] };
}

/**
 * Right-rail TOC for /about (#620). Mirrors the docs page's "On this page"
 * panel: two top-level sections — About and Changelog — with versions
 * nested under Changelog as date-stripped numbers.
 *
 * Scroll-spy picks the closest section above the fold and highlights it,
 * including nested version entries when scrolled into a particular release.
 */
export default function AboutToc({ about, changelog }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const trackedIds = [
      about.id,
      changelog.id,
      ...changelog.versions.map((v) => v.id),
    ];
    if (!trackedIds.length) return;

    const updateActive = () => {
      const topOffset = 120;
      let active: string | null = trackedIds[0] ?? null;
      for (const id of trackedIds) {
        const el = document.getElementById(id);
        if (!el) continue;
        if (el.getBoundingClientRect().top - topOffset <= 0) {
          active = id;
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
  }, [about.id, changelog.id, changelog.versions]);

  function linkClass(id: string, indented = false): string {
    const base = "block text-sm transition-colors hover:text-foreground";
    const indent = indented ? "ml-3" : "";
    const active =
      activeId === id ? "font-medium text-foreground" : "text-muted-foreground";
    return `${base} ${indent} ${active}`;
  }

  return (
    <aside className="hidden xl:block">
      <div className="sticky top-20">
        <h2 className="mb-2 text-sm font-semibold text-muted-foreground">
          On this page
        </h2>
        <nav className="space-y-1">
          <a href={`#${about.id}`} className={linkClass(about.id)}>
            {about.label}
          </a>
          <a href={`#${changelog.id}`} className={linkClass(changelog.id)}>
            {changelog.label}
          </a>
          {changelog.versions.map((v) => (
            <a
              key={v.id}
              href={`#${v.id}`}
              className={linkClass(v.id, true)}
            >
              {stripDate(v.text)}
            </a>
          ))}
        </nav>
      </div>
    </aside>
  );
}

/**
 * `[0.3.0] — 2026-04-24` → `[0.3.0]`. Per #620, the changelog rail shows
 * versions only as numbers; the date sits next to the rendered heading
 * itself anyway so it's redundant in the rail.
 */
export function stripDate(text: string): string {
  return text.replace(/\s*[—–-]\s*\d{4}-\d{2}-\d{2}.*$/, "").trim();
}
