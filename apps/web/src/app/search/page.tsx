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
import { Button } from "@/components/ui/button";
import SearchInput from "@/components/SearchInput";
import HelpPopover from "@/components/HelpPopover";
import SearchSpinner from "@/components/SearchSpinner";
import PodcastFilter from "@/components/PodcastFilter";
import type { SearchPage as SearchPageType, GroupedSearchResult } from "@/lib/search";
import { loadSearchSnapshot, saveSearchSnapshot } from "@/lib/page-state";

const PAGE_SIZE = 20;

type ViewMode = "grouped" | "flat";

interface Feed {
  id: string;
  title: string | null;
  episode_count: number;
}

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
  const initialSnapshot = loadSearchSnapshot();

  const [query, setQuery] = useState(
    initialQuery || initialSnapshot?.query || ""
  );
  const [submittedQuery, setSubmittedQuery] = useState(
    initialQuery || initialSnapshot?.submittedQuery || ""
  );
  const [selectedFeedIds, setSelectedFeedIds] = useState<Set<string>>(
    new Set(initialSnapshot?.selectedFeedIds || [])
  );
  const [page, setPage] = useState(
    initialQuery ? 1 : initialSnapshot?.page || 1
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    initialSnapshot?.viewMode || "grouped"
  );

  const [feeds, setFeeds] = useState<Feed[]>([]);
  const [hasManualUploads, setHasManualUploads] = useState(false);

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
  const statsQuery = useQuery<{ feedCount: number; episodeCount: number; processing: number }>({
    queryKey: ["search-stats"],
    queryFn: async () => {
      const [feedsResp, coverageResp] = await Promise.all([
        fetch("/api/feeds"),
        fetch("/api/ask/coverage"),
      ]);
      const feedsData = feedsResp.ok ? await feedsResp.json() : [];
      const feedCount = Array.isArray(feedsData) ? feedsData.length : 0;
      if (Array.isArray(feedsData)) setFeeds(feedsData);
      const covData = coverageResp.ok ? await coverageResp.json() : {};
      const episodeCount = covData.processed ?? 0;
      const processing = Math.max(0, (covData.total ?? 0) - (covData.processed ?? 0));
      setHasManualUploads(covData.has_manual_uploads ?? false);
      return { feedCount, episodeCount, processing };
    },
    staleTime: 60_000,
  });

  // Sync state when URL ?q= param changes (e.g. browser back/forward)
  useEffect(() => {
    const urlQuery = searchParams.get("q") ?? "";
    if (urlQuery && urlQuery !== submittedQuery) {
      setQuery(urlQuery);
      setSubmittedQuery(urlQuery);
      setPage(1);
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    saveSearchSnapshot({
      query,
      submittedQuery,
      selectedFeedIds: Array.from(selectedFeedIds),
      page,
      viewMode,
    });
  }, [query, submittedQuery, selectedFeedIds, page, viewMode]);

  // Separate real feed UUIDs from the __uploads__ sentinel
  const includeManualUploads = selectedFeedIds.has("__uploads__");
  const feedFilterParam = Array.from(selectedFeedIds)
    .filter((id) => id !== "__uploads__")
    .join(",");

  // Flat search query
  const flatCacheKey = `${submittedQuery}:${feedFilterParam}:${includeManualUploads}`;
  const flatQuery = useQuery<SearchPageType>({
    queryKey: ["search", submittedQuery, feedFilterParam, includeManualUploads, page],
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
      if (feedFilterParam) params.set("feedId", feedFilterParam);
      if (includeManualUploads) params.set("uploads", "true");
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
  const groupedCacheKey = `${submittedQuery}:${feedFilterParam}:${includeManualUploads}`;
  const groupedQuery = useQuery<GroupedSearchResult>({
    queryKey: ["search-grouped", submittedQuery, feedFilterParam, includeManualUploads, page],
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
      if (feedFilterParam) params.set("feedId", feedFilterParam);
      if (includeManualUploads) params.set("uploads", "true");
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

  function handleClear() {
    setQuery("");
    setSubmittedQuery("");
    setPage(1);
    router.replace("/search", { scroll: false });
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
          {/* Title + help popover */}
          <HelpPopover title="Search">
            <p className="font-medium mb-1">Search tips</p>
            <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
              <li>Use quotes for exact phrases: &quot;machine learning&quot;</li>
              <li>Exclude words with minus: climate -politics</li>
              <li>Combine terms: AI regulation ethics</li>
            </ul>
          </HelpPopover>

          {/* Search input */}
          <SearchInput
            value={query}
            onChange={setQuery}
            onSubmit={handleSubmit}
            onClear={handleClear}
            placeholder="Search transcripts..."
            icon={<Search size={18} />}
          />

          {/* Stats below search bar */}
          {!submittedQuery && statsQuery.data && (
            <p className="text-center text-xs text-muted-foreground">
              Searching across {statsQuery.data.feedCount} podcast
              {statsQuery.data.feedCount !== 1 ? "s" : ""} and{" "}
              {statsQuery.data.episodeCount} episode
              {statsQuery.data.episodeCount !== 1 ? "s" : ""}
              {statsQuery.data.processing > 0 && (
                <> ({statsQuery.data.processing} still processing)</>
              )}
            </p>
          )}

          {/* Podcast filter */}
          <div className="flex justify-center">
            <PodcastFilter
              feeds={feeds}
              selectedFeedIds={selectedFeedIds}
              onSelectionChange={setSelectedFeedIds}
              hasManualUploads={hasManualUploads}
            />
          </div>
        </div>
      </div>

      {/* Search spinner */}
      {submittedQuery && isLoading && (
        <SearchSpinner label="Searching..." />
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
