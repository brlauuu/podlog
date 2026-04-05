"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  Mic,
  Search,
  AudioWaveform,
  Headphones,
  Database,
  Shield,
} from "lucide-react";

interface FeedStats {
  id: string;
  title: string | null;
  episode_count: number;
}

export default function HomePage() {
  const [feeds, setFeeds] = useState<FeedStats[]>([]);
  const [totalEpisodes, setTotalEpisodes] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/feeds").then((r) => r.json()).catch(() => []),
      fetch("/api/ask/coverage").then((r) => r.json()).catch(() => ({ total: 0 })),
    ]).then(([feedsData, coverageData]) => {
      if (Array.isArray(feedsData)) setFeeds(feedsData);
      setTotalEpisodes(coverageData.total || 0);
    }).finally(() => setLoading(false));
  }, []);

  return (
    <div className="flex flex-col items-center pt-12 pb-16 space-y-10">
      {/* Hero section */}
      <div className="text-center space-y-6">
        {/* Icon composition */}
        <div className="flex items-center justify-center gap-3 text-muted-foreground">
          <Mic size={28} className="text-primary" />
          <AudioWaveform size={36} className="text-primary/60" />
          <Headphones size={32} className="text-primary/80" />
          <AudioWaveform size={36} className="text-primary/60 scale-x-[-1]" />
          <Search size={28} className="text-primary" />
        </div>

        <div className="space-y-3">
          <h1 className="text-4xl font-bold tracking-tight">Podlog</h1>
          <p className="text-lg text-muted-foreground max-w-md mx-auto">
            Your self-hosted transcription database. Custom, private, offline, yours.
          </p>
        </div>
      </div>

      {/* Quick links */}
      <div className="flex gap-4">
        <Link
          href="/search"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
        >
          <Search size={16} />
          Search
        </Link>
        <Link
          href="/ask"
          className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors"
        >
          <Database size={16} />
          Ask AI
        </Link>
      </div>

      {/* Stats */}
      {!loading && feeds.length > 0 && (
        <div className="text-center space-y-2 max-w-lg">
          <p className="text-sm text-muted-foreground">
            This database contains {feeds.length} podcast
            {feeds.length !== 1 ? "s" : ""} with {totalEpisodes} episode
            {totalEpisodes !== 1 ? "s" : ""}:
          </p>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-sm">
            {feeds.map((feed) => (
              <span key={feed.id} className="text-foreground">
                {feed.title || "Untitled"}{" "}
                <span className="text-muted-foreground">
                  ({feed.episode_count} ep{feed.episode_count !== 1 ? "s" : ""})
                </span>
              </span>
            ))}
          </div>
        </div>
      )}
      {!loading && feeds.length === 0 && (
        <div className="text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            No podcasts yet.{" "}
            <Link href="/podcasts" className="text-primary hover:underline">
              Add your first feed
            </Link>{" "}
            to get started.
          </p>
        </div>
      )}

      {/* Features */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 max-w-xl text-center">
        <div className="space-y-1.5">
          <Shield size={20} className="mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Fully self-hosted. Your data never leaves your machine.
          </p>
        </div>
        <div className="space-y-1.5">
          <Search size={20} className="mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            Full-text and semantic search across every transcript.
          </p>
        </div>
        <div className="space-y-1.5">
          <Database size={20} className="mx-auto text-muted-foreground" />
          <p className="text-xs text-muted-foreground">
            RAG-powered AI answers grounded in your episodes.
          </p>
        </div>
      </div>
    </div>
  );
}
