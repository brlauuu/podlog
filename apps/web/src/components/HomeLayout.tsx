"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Home-page layout (#1086): the logo and buttons sit exactly where they would
 * with no recent activity, and the list that arrives after load goes directly
 * under them. When it does not fit, it pushes the footer down and the page
 * scrolls; the logo and buttons never move.
 *
 * Server render and the empty state are plain CSS: two equal growing spacers
 * centre the hero. That alone is not enough once the list arrives, because a flex
 * spacer always gives up space to a taller sibling, so a list taller than the
 * space below the buttons would pull them up. Instead the top spacer is pinned
 * to its no-list height, worked out from the viewport (by then the page may be
 * taller than the viewport), and only the space below grows.
 */
export default function HomeLayout({
  hero,
  children,
}: {
  hero: React.ReactNode;
  children: React.ReactNode;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const heroRef = useRef<HTMLDivElement>(null);
  const belowRef = useRef<HTMLDivElement>(null);
  const [topHeight, setTopHeight] = useState<number | null>(null);

  useLayoutEffect(() => {
    const root = rootRef.current;
    const heroEl = heroRef.current;
    const below = belowRef.current;
    if (!root || !heroEl || !below || typeof ResizeObserver === "undefined") return;

    const update = () => {
      // The height the root fills when its content fits: what the body's
      // min-h-screen column leaves after the navbar, footer and main's padding.
      const main = root.parentElement;
      const footer = document.querySelector("footer");
      const top = root.getBoundingClientRect().top + window.scrollY;
      const padBottom = main ? parseFloat(getComputedStyle(main).paddingBottom) || 0 : 0;
      const available = window.innerHeight - top - padBottom - (footer?.offsetHeight ?? 0);
      setTopHeight(Math.max(0, Math.round((available - heroEl.offsetHeight) / 2)));
    };

    update();
    const ro = new ResizeObserver(update);
    ro.observe(heroEl);
    ro.observe(below);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
    };
  }, []);

  return (
    <div ref={rootRef} className="flex-1 flex flex-col items-center">
      <div
        data-testid="home-top-spacer"
        aria-hidden="true"
        className={topHeight === null ? "grow basis-0" : "flex-none"}
        style={topHeight === null ? undefined : { height: topHeight }}
      />
      <div ref={heroRef} data-testid="home-hero" className="w-full flex flex-col items-center space-y-8">
        {hero}
      </div>
      {/* Both spacers are grow + basis-0, not flex-1. flex-1 is a 0% basis,
          which against main's indefinite height resolves to content size:
          the lower spacer then started from the list's height (or the 32px
          gap when empty) and the hero sat 16px above centre before
          hydration. */}
      <div ref={belowRef} data-testid="home-recent-row" className="grow basis-0 w-full">
        <div className="w-full flex justify-center pt-8">{children}</div>
      </div>
    </div>
  );
}
