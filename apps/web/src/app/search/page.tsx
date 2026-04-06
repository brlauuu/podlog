"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import {
  Search,
  List,
  Layers,
} from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import SearchResult from "@/components/SearchResult";
import FeedGroupCard from "@/components/FeedGroupCard";
import DownloadReportButton from "@/components/DownloadReportButton";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { SearchPage as SearchPageType, GroupedSearchResult } from "@/lib/search";

const PAGE_SIZE = 20;

type ViewMode = "grouped" | "flat";

const SEARCH_TIPS = [
  'Use quotes for exact phrases: "machine learning"',
  "Exclude words with minus: climate -politics",
  "Combine terms: AI regulation ethics",
];

/**
 * Wrapper that provides the required Suspense boundary for useSearchParams().
 */
export default function SearchPage() {
  return (
    <Suspense fallback={null}>
      <SearchPageContent />
    </Suspense>
  );
}

function SearchPageContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const initialQuery = searchParams.get("q") ?? "";

  const [query, setQuery] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [feedFilter, setFeedFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");

  // Cache totals from page 1 to skip COUNT(*) on subsequent pages
  const cachedFlatTotal = useRef<{ key: string; total: number } | null>(null);
  const cachedGroupedTotals = useRef<{
    key: string;
    totalFeeds: number;
    totalEpisodes: number;
    totalMentions: number;
  } | null>(null);

  // Fetch stats for the info line below search — uses coverage endpoint
  // to include manual uploads (episodes with no feed_id)
  const statsQuery = useQuery<{ feedCount: number; episodeCount: number }>({
    queryKey: ["search-stats"],
    queryFn: async () => {
      const [feedsResp, coverageResp] = await Promise.all([
        fetch("/api/feeds"),
        fetch("/api/ask/coverage"),
      ]);
      const feedCount = feedsResp.ok ? (await feedsResp.json()).length : 0;
      const episodeCount = coverageResp.ok
        ? (await coverageResp.json()).processed
        : 0;
      return { feedCount, episodeCount };
    },
    staleTime: 60_000,
  });

  // Sync state when URL ?q= param changes (e.g. browser back/forward)
  useEffect(() => {
    const urlQuery = searchParams.get("q") ?? "";
    if (urlQuery !== submittedQuery) {
      setQuery(urlQuery);
      setSubmittedQuery(urlQuery);
      setPage(1);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Flat search query
  const flatCacheKey = `${submittedQuery}:${feedFilter}`;
  const flatQuery = useQuery<SearchPageType>({
    queryKey: ["search", submittedQuery, feedFilter, page],
    queryFn: async () => {
      if (!submittedQuery)
        return {
          results: [],
          total: 0,
          page: 1,
          pageSize: PAGE_SIZE,
          coverage: { processed: 0, total: 0 },
        };
      const canSkipCount =
        page > 1 && cachedFlatTotal.current?.key === flatCacheKey;
      const params = new URLSearchParams({
        q: submittedQuery,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (feedFilter) params.set("feedId", feedFilter);
      if (canSkipCount) params.set("skipCount", "true");
      const resp = await fetch(`/api/search?${params}`);
      if (!resp.ok) throw new Error("Search failed");
      const data: SearchPageType = await resp.json();
      if (data.total >= 0) {
        cachedFlatTotal.current = { key: flatCacheKey, total: data.total };
      } else if (cachedFlatTotal.current?.key === flatCacheKey) {
        data.total = cachedFlatTotal.current.total;
      }
      return data;
    },
    enabled: Boolean(submittedQuery) && viewMode === "flat",
    staleTime: 30_000,
  });

  // Grouped search query
  const groupedCacheKey = `${submittedQuery}:${feedFilter}`;
  const groupedQuery = useQuery<GroupedSearchResult>({
    queryKey: ["search-grouped", submittedQuery, feedFilter, page],
    queryFn: async () => {
      if (!submittedQuery)
        return {
          feeds: [],
          totalFeeds: 0,
          totalEpisodes: 0,
          totalMentions: 0,
          coverage: { processed: 0, total: 0 },
        };
      const canSkipCount =
        page > 1 && cachedGroupedTotals.current?.key === groupedCacheKey;
      const params = new URLSearchParams({
        q: submittedQuery,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (feedFilter) params.set("feedId", feedFilter);
      if (canSkipCount) params.set("skipCount", "true");
      const resp = await fetch(`/api/search/grouped?${params}`);
      if (!resp.ok) throw new Error("Search failed");
      const data: GroupedSearchResult = await resp.json();
      if (data.totalMentions >= 0) {
        cachedGroupedTotals.current = {
          key: groupedCacheKey,
          totalFeeds: data.totalFeeds,
          totalEpisodes: data.totalEpisodes,
          totalMentions: data.totalMentions,
        };
      } else if (cachedGroupedTotals.current?.key === groupedCacheKey) {
        data.totalFeeds = cachedGroupedTotals.current.totalFeeds;
        data.totalEpisodes = cachedGroupedTotals.current.totalEpisodes;
        data.totalMentions = cachedGroupedTotals.current.totalMentions;
      }
      return data;
    },
    enabled: Boolean(submittedQuery) && viewMode === "grouped",
    staleTime: 30_000,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    setPage(1);
    setSubmittedQuery(trimmed);
    if (trimmed) {
      router.replace(`/search?q=${encodeURIComponent(trimmed)}`, {
        scroll: false,
      });
    } else {
      router.replace("/search", { scroll: false });
    }
  }

  const isLoading =
    viewMode === "flat"
      ? flatQuery.isLoading || flatQuery.isFetching
      : groupedQuery.isLoading || groupedQuery.isFetching;

  const totalPages =
    viewMode === "flat" && flatQuery.data
      ? Math.ceil(flatQuery.data.total / PAGE_SIZE)
      : 0;

  return (
    <div className="space-y-6">
      {/* Centered header + search bar */}
      <div className={`flex flex-col items-center ${submittedQuery ? "pt-2" : "pt-16"} transition-all`}>
        <div className="w-full max-w-2xl space-y-3">
          {/* Title + description */}
          <div className="text-center space-y-1">
            <h1 className="text-3xl font-bold">Search</h1>
            <p className="text-sm text-muted-foreground">
              Full-text search across all transcribed episodes
            </p>
          </div>

          {/* Search input */}
          <form onSubmit={handleSubmit}>
            <div className="relative">
              <Search
                size={18}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search transcripts..."
                className="w-full pl-10 pr-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-2 focus:ring-ring text-base transition-shadow"
                autoFocus
              />
            </div>
          </form>

          {/* Stats below search bar */}
          {!submittedQuery && statsQuery.data && (
            <p className="text-center text-xs text-muted-foreground">
              Searching across {statsQuery.data.feedCount} podcast
              {statsQuery.data.feedCount !== 1 ? "s" : ""} and{" "}
              {statsQuery.data.episodeCount} episode
              {statsQuery.data.episodeCount !== 1 ? "s" : ""}
            </p>
          )}

          {/* Search tips */}
          {!submittedQuery && (
            <div className="rounded-lg border border-border bg-muted/50 px-4 py-3 text-xs text-muted-foreground space-y-1">
              <p className="font-medium text-foreground">Search tips</p>
              <ul className="list-disc list-inside space-y-0.5">
                {SEARCH_TIPS.map((tip) => (
                  <li key={tip}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>

      {/* Search spinner — equalizer style */}
      {submittedQuery && isLoading && (
        <div className="flex flex-col items-center gap-2 py-8">
          <div className="flex items-center gap-0.5">
            {[0, 1, 2, 3, 4, 5, 6].map((i) => (
              <span
                key={i}
                className="w-1 rounded-full bg-primary animate-[eqBar_1.4s_ease-in-out_infinite]"
                style={{ animationDelay: `${i * 0.1}s` }}
              />
            ))}
          </div>
          <span className="text-sm text-muted-foreground">Searching...</span>
        </div>
      )}

      {submittedQuery && !isLoading && (
        <div className="space-y-4">
          {/* View mode toggle */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {viewMode === "grouped" && groupedQuery.data
                ? `Found in ${groupedQuery.data.totalFeeds} podcast${groupedQuery.data.totalFeeds !== 1 ? "s" : ""}, ${groupedQuery.data.totalEpisodes} episode${groupedQuery.data.totalEpisodes !== 1 ? "s" : ""} (${groupedQuery.data.totalMentions} mention${groupedQuery.data.totalMentions !== 1 ? "s" : ""})`
                : viewMode === "flat" && flatQuery.data
                  ? `Page ${page} of ${totalPages} · ${flatQuery.data.total} results`
                  : ""}
              {(() => {
                const cov =
                  viewMode === "grouped"
                    ? groupedQuery.data?.coverage
                    : flatQuery.data?.coverage;
                if (cov && cov.total > 0 && cov.processed < cov.total) {
                  return ` · Searching ${cov.processed} of ${cov.total} episodes`;
                }
                return null;
              })()}
            </div>
            <div className="flex items-center gap-2">
              <DownloadReportButton
                query={submittedQuery}
                viewMode={viewMode}
                flatResults={
                  viewMode === "flat" ? flatQuery.data?.results : undefined
                }
                groupedResults={
                  viewMode === "grouped" ? groupedQuery.data : undefined
                }
              />
              <div className="flex items-center border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => {
                    setViewMode("grouped");
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                    viewMode === "grouped"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent/30"
                  }`}
                  title="Grouped view"
                >
                  <Layers size={13} />
                  Grouped
                </button>
                <button
                  onClick={() => {
                    setViewMode("flat");
                    setPage(1);
                  }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${
                    viewMode === "flat"
                      ? "bg-primary text-primary-foreground"
                      : "hover:bg-accent/30"
                  }`}
                  title="Flat view"
                >
                  <List size={13} />
                  Flat
                </button>
              </div>
            </div>
          </div>

          {viewMode === "grouped" ? (
            groupedQuery.data && groupedQuery.data.feeds.length > 0 ? (
              <div className="space-y-3">
                {groupedQuery.data.feeds.map((feed) => (
                  <FeedGroupCard
                    key={feed.feedId}
                    feed={feed}
                    query={submittedQuery}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 space-y-2">
                <p className="text-muted-foreground">
                  No results for &ldquo;{submittedQuery}&rdquo;
                </p>
                <p className="text-sm text-muted-foreground">
                  Try checking your spelling, or use broader search terms.
                </p>
              </div>
            )
          ) : flatQuery.data && flatQuery.data.results.length > 0 ? (
            <>
              <div className="space-y-3">
                {flatQuery.data.results.map((result) => (
                  <SearchResult
                    key={result.id}
                    result={result}
                    query={submittedQuery}
                  />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                  >
                    &larr; Previous
                  </Button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                  >
                    Next &rarr;
                  </Button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16 space-y-2">
              <p className="text-muted-foreground">
                No results for &ldquo;{submittedQuery}&rdquo;
              </p>
              <p className="text-sm text-muted-foreground">
                Try checking your spelling, or use broader search terms.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
