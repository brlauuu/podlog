"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  FlaskConical,
  LayoutGrid,
  List,
  ListChecks,
  Podcast,
  Rows3,
  Rss,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export interface PodcastsListFeed {
  id: string;
  title: string | null;
  description: string | null;
  image_url: string | null;
  mode: string;
  episode_count: number;
  processed_count: number;
  last_polled_at: string | null;
}

type ViewMode = "list" | "grid" | "large";

const STORAGE_KEY = "podlog-podcasts-view";
const DEFAULT_VIEW: ViewMode = "grid";

function isViewMode(v: unknown): v is ViewMode {
  return v === "list" || v === "grid" || v === "large";
}

interface Props {
  feeds: PodcastsListFeed[];
  /** Optional initial mode override — primarily for tests to avoid localStorage dance. */
  initialView?: ViewMode;
}

export default function PodcastsList({ feeds, initialView }: Props) {
  const [view, setView] = useState<ViewMode>(initialView ?? DEFAULT_VIEW);

  useEffect(() => {
    if (initialView) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (isViewMode(stored)) setView(stored);
    } catch {}
  }, [initialView]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, view);
    } catch {}
  }, [view]);

  const feedEpisodeTotal = feeds.reduce((sum, f) => sum + f.episode_count, 0);
  const feedEpisodeProcessed = feeds.reduce((sum, f) => sum + f.processed_count, 0);

  return (
    <div data-view={view}>
      <div className="flex items-center justify-between mb-3 gap-3 flex-wrap">
        <h2 className="text-xl font-semibold">
          Podcasts
          <span className="ml-2 text-sm font-normal text-muted-foreground">
            ({feedEpisodeTotal > 0 && feedEpisodeProcessed < feedEpisodeTotal
              ? `${feedEpisodeProcessed} / ${feedEpisodeTotal} episodes processed`
              : `${feeds.length} podcast${feeds.length !== 1 ? "s" : ""}`})
          </span>
        </h2>
        <div className="flex items-center gap-2">
          <ViewToggle view={view} onChange={setView} />
          <Button className="h-7 px-2.5 text-xs gap-1.5 [&_svg]:size-3" asChild>
            <Link href="/feeds">
              <Rss />
              Manage feeds
            </Link>
          </Button>
        </div>
      </div>

      {view === "list" && <FeedListRows feeds={feeds} />}
      {view === "grid" && <FeedGrid feeds={feeds} density="default" />}
      {view === "large" && <FeedGrid feeds={feeds} density="large" />}
    </div>
  );
}

function ViewToggle({
  view,
  onChange,
}: {
  view: ViewMode;
  onChange: (v: ViewMode) => void;
}) {
  const options: { mode: ViewMode; label: string; icon: React.ReactNode }[] = [
    { mode: "list", label: "List view", icon: <List size={14} /> },
    { mode: "grid", label: "Grid view", icon: <LayoutGrid size={14} /> },
    { mode: "large", label: "Large tiles", icon: <Rows3 size={14} /> },
  ];
  return (
    <div
      role="group"
      aria-label="Podcast view mode"
      className="inline-flex rounded-md border bg-background overflow-hidden"
    >
      {options.map((opt) => {
        const active = view === opt.mode;
        return (
          <button
            key={opt.mode}
            type="button"
            aria-label={opt.label}
            aria-pressed={active}
            onClick={() => onChange(opt.mode)}
            className={`h-7 w-8 flex items-center justify-center transition-colors ${
              active
                ? "bg-accent text-foreground"
                : "text-muted-foreground hover:bg-accent/60"
            }`}
          >
            {opt.icon}
          </button>
        );
      })}
    </div>
  );
}

function ModeBadges({ mode }: { mode: string }) {
  return (
    <>
      {mode === "test" && (
        <Badge
          variant="outline"
          className="shrink-0 text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-0.5 text-[10px] px-1 py-0"
        >
          <FlaskConical size={9} />
          Test
        </Badge>
      )}
      {mode === "selective" && (
        <Badge
          variant="outline"
          className="shrink-0 text-sky-700 border-sky-300 dark:text-sky-300 dark:border-sky-700 gap-0.5 text-[10px] px-1 py-0"
        >
          <ListChecks size={9} />
          Selective
        </Badge>
      )}
    </>
  );
}

function EpisodeCounter({ feed }: { feed: PodcastsListFeed }) {
  return (
    <p className="text-xs text-muted-foreground">
      {feed.processed_count === feed.episode_count
        ? `${feed.episode_count} episodes`
        : `${feed.processed_count} / ${feed.episode_count} episodes processed`}
    </p>
  );
}

function ImageOrPlaceholder({
  feed,
  size,
}: {
  feed: PodcastsListFeed;
  size: number;
}) {
  const common = `aspect-square object-cover`;
  if (feed.image_url) {
    return (
      <Image
        src={feed.image_url}
        alt={feed.title ?? "Podcast"}
        width={size}
        height={size}
        className={`${common} w-full`}
      />
    );
  }
  return (
    <div
      className={`${common} w-full bg-muted flex items-center justify-center text-muted-foreground`}
    >
      <Podcast className="h-1/3 w-1/3" />
    </div>
  );
}

function FeedGrid({
  feeds,
  density,
}: {
  feeds: PodcastsListFeed[];
  density: "default" | "large";
}) {
  const gridClass =
    density === "large"
      ? "grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5"
      : "grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4";
  const imgSize = density === "large" ? 480 : 300;
  return (
    <div className={gridClass}>
      {feeds.map((feed) => (
        <Link key={feed.id} href={`/podcasts/${feed.id}`}>
          <Card className="overflow-hidden hover:bg-accent/30 transition-colors h-full">
            <ImageOrPlaceholder feed={feed} size={imgSize} />
            <CardContent
              className={density === "large" ? "p-4 space-y-1.5" : "p-3 space-y-1"}
            >
              <div className="flex items-center gap-1.5">
                <p
                  className={`font-medium line-clamp-2 ${
                    density === "large" ? "text-base" : "text-sm"
                  }`}
                >
                  {feed.title ?? "Untitled"}
                </p>
                <ModeBadges mode={feed.mode} />
              </div>
              <EpisodeCounter feed={feed} />
              {density === "large" && feed.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {feed.description}
                </p>
              )}
            </CardContent>
          </Card>
        </Link>
      ))}
    </div>
  );
}

function FeedListRows({ feeds }: { feeds: PodcastsListFeed[] }) {
  return (
    <div className="divide-y rounded-md border">
      {feeds.map((feed) => (
        <Link
          key={feed.id}
          href={`/podcasts/${feed.id}`}
          className="flex items-center gap-3 p-3 hover:bg-accent/30 transition-colors"
        >
          <div className="w-12 shrink-0">
            <ImageOrPlaceholder feed={feed} size={96} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-medium truncate">
                {feed.title ?? "Untitled"}
              </p>
              <ModeBadges mode={feed.mode} />
            </div>
            <EpisodeCounter feed={feed} />
          </div>
        </Link>
      ))}
    </div>
  );
}
