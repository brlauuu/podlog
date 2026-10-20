"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Podcast } from "lucide-react";
import { formatDayMonth } from "@/lib/dateFormat";

/** One row of GET /api/queue/recent (pipeline `recent_activity`). */
export interface RecentEpisode {
  episode_id: string;
  title: string | null;
  published_at: string | null;
  feed_title: string | null;
  feed_image_url: string | null;
  outcome: "done" | "failed";
  finished_at: string | null;
}

export const ROW_HEIGHT = 56;
export const VISIBLE_ROWS = 3;
const SECONDS_PER_CARD = 4;
// A touch has no "leave", so after a swipe the roll resumes on its own.
const TOUCH_RESUME_MS = 3000;

const FADE = "linear-gradient(transparent, #000 22%, #000 78%, transparent)";

/**
 * Home-page roller of episodes finished or failed in the last 7 days (#1079).
 *
 * Three cards show at a time. With more than three it rolls continuously and
 * wraps endlessly; hovering, focusing or touching it stops the roll and lets
 * the list be scrolled by hand. Three or fewer simply sit still, and none at
 * all renders nothing, so the home page looks as it did before.
 */
export default function RecentActivity() {
  const [items, setItems] = useState<RecentEpisode[]>([]);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/queue/recent")
      .then((r) => (r.ok ? r.json() : []))
      .then((data) => {
        if (!cancelled && Array.isArray(data)) setItems(data);
      })
      // The roller is decoration on the home page; a failed read hides it.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (items.length === 0) return null;
  if (items.length <= VISIBLE_ROWS) {
    return (
      <ul aria-label="Processed this week" className="w-full max-w-[280px] sm:max-w-[420px]">
        {items.map((ep) => (
          <li key={ep.episode_id}>
            <Card ep={ep} />
          </li>
        ))}
      </ul>
    );
  }
  return <Roller items={items} />;
}

function Roller({ items }: { items: RecentEpisode[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const loop = items.length * ROW_HEIGHT;

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Three copies back to back; the position is kept inside the middle one,
    // so the list never runs out in either direction and the wrap is
    // invisible -- the view one copy up or down is identical.
    let y = loop;
    el.scrollTop = y;
    let held = false;
    let resumeTimer: ReturnType<typeof setTimeout> | undefined;
    const reduceMotion =
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const hold = () => {
      clearTimeout(resumeTimer);
      held = true;
    };
    const release = () => {
      held = false;
      y = el.scrollTop;
    };
    const releaseLater = () => {
      clearTimeout(resumeTimer);
      resumeTimer = setTimeout(release, TOUCH_RESUME_MS);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (!el.contains(e.relatedTarget as Node | null)) release();
    };
    const wrap = () => {
      if (el.scrollTop < loop) el.scrollTop += loop;
      else if (el.scrollTop >= 2 * loop) el.scrollTop -= loop;
    };

    el.addEventListener("mouseenter", hold);
    el.addEventListener("mouseleave", release);
    el.addEventListener("focusin", hold);
    el.addEventListener("focusout", onFocusOut);
    el.addEventListener("touchstart", hold, { passive: true });
    el.addEventListener("touchend", releaseLater);
    el.addEventListener("scroll", wrap);

    let frame = 0;
    let last: number | null = null;
    const speed = ROW_HEIGHT / SECONDS_PER_CARD; // px per second
    const tick = (t: number) => {
      if (last !== null && !held) {
        y += (speed * (t - last)) / 1000;
        if (y >= 2 * loop) y -= loop;
        el.scrollTop = y;
      }
      last = t;
      frame = requestAnimationFrame(tick);
    };
    // Reduced motion: no roll, but still scrollable and still endless.
    if (!reduceMotion) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(resumeTimer);
      el.removeEventListener("mouseenter", hold);
      el.removeEventListener("mouseleave", release);
      el.removeEventListener("focusin", hold);
      el.removeEventListener("focusout", onFocusOut);
      el.removeEventListener("touchstart", hold);
      el.removeEventListener("touchend", releaseLater);
      el.removeEventListener("scroll", wrap);
    };
  }, [loop]);

  return (
    <div
      ref={ref}
      data-testid="recent-activity-roller"
      className="w-full max-w-[280px] sm:max-w-[420px] overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      style={{ height: ROW_HEIGHT * VISIBLE_ROWS, maskImage: FADE, WebkitMaskImage: FADE }}
    >
      {[0, 1, 2].map((copy) => (
        // Only the middle copy is real to assistive tech and the tab order;
        // the outer two exist so the roll can wrap without a visible seam.
        <ul
          key={copy}
          aria-label={copy === 1 ? "Processed this week" : undefined}
          aria-hidden={copy === 1 ? undefined : true}
        >
          {items.map((ep) => (
            <li key={ep.episode_id}>
              <Card ep={ep} tabIndex={copy === 1 ? undefined : -1} />
            </li>
          ))}
        </ul>
      ))}
    </div>
  );
}

function Card({ ep, tabIndex }: { ep: RecentEpisode; tabIndex?: number }) {
  const failed = ep.outcome === "failed";
  return (
    <Link
      href={`/episodes/${ep.episode_id}`}
      tabIndex={tabIndex}
      className="flex items-center gap-3 px-2 rounded-lg hover:bg-accent transition-colors"
      style={{ height: ROW_HEIGHT }}
    >
      {ep.feed_image_url ? (
        <Image
          src={ep.feed_image_url}
          alt=""
          width={38}
          height={38}
          className="h-[38px] w-[38px] flex-none rounded object-cover"
        />
      ) : (
        <div className="h-[38px] w-[38px] flex-none rounded bg-muted flex items-center justify-center text-muted-foreground">
          <Podcast size={16} />
        </div>
      )}
      <div className="min-w-0 flex-1 text-center">
        <div className="truncate text-xs text-muted-foreground">{ep.feed_title ?? "Unknown podcast"}</div>
        <div className="truncate text-sm text-foreground">{ep.title ?? "Untitled episode"}</div>
      </div>
      <div className="flex w-14 flex-none flex-col items-center gap-1">
        <span
          className={`h-2 w-2 rounded-full ${failed ? "bg-red-600" : "bg-green-600"}`}
          title={failed ? "Something went wrong" : "Processed"}
        />
        <span className="sr-only">{failed ? "Failed" : "Processed"}</span>
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {formatDayMonth(ep.published_at)}
        </span>
      </div>
    </Link>
  );
}
