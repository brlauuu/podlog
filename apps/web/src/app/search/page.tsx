"use client";

import { Suspense, useState, useEffect, useRef } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import SearchResult from "@/components/SearchResult";
import FeedGroupCard from "@/components/FeedGroupCard";
import { Button } from "@/components/ui/button";
import SearchSpinner from "@/components/SearchSpinner";
import SearchTopPanel from "@/components/SearchTopPanel";
import SearchResultsToolbar from "@/components/SearchResultsToolbar";
import type { SearchPage as SearchPageType, GroupedSearchResult } from "@/lib/search";
import { loadSearchSnapshot, saveSearchSnapshot } from "@/lib/page-state";

const DEFAULT_PAGE_SIZE = 20;
const PAGE_SIZE_OPTIONS = [20, 50, 100] as const;
const isValidPageSize = (value: number): value is (typeof PAGE_SIZE_OPTIONS)[number] =>
  PAGE_SIZE_OPTIONS.includes(value as (typeof PAGE_SIZE_OPTIONS)[number]);

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
  const [selectedSpeaker, setSelectedSpeaker] = useState<string | null>(
    initialSnapshot?.selectedSpeaker ?? null
  );
  const [page, setPage] = useState(
    initialQuery ? 1 : initialSnapshot?.page || 1
  );
  const [pageSize, setPageSize] = useState(
    initialSnapshot?.pageSize && isValidPageSize(initialSnapshot.pageSize)
      ? initialSnapshot.pageSize
      : DEFAULT_PAGE_SIZE
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

  // Load feeds independently so Source filter can show even if coverage endpoint is slower.
  const feedsQuery = useQuery<Feed[]>({
    queryKey: ["search-feeds"],
    queryFn: async () => {
      const resp = await fetch("/api/feeds");
      if (!resp.ok) return [];
      const data = await resp.json();
      return Array.isArray(data) ? data : [];
    },
    staleTime: 60_000,
  });

  // Coverage powers the processed/total info line and manual-upload marker.
  const coverageQuery = useQuery<{ processed: number; total: number; has_manual_uploads: boolean }>({
    queryKey: ["search-coverage"],
    queryFn: async () => {
      const resp = await fetch("/api/ask/coverage");
      if (!resp.ok) return { processed: 0, total: 0, has_manual_uploads: false };
      const data = await resp.json();
      return {
        processed: data.processed ?? 0,
        total: data.total ?? 0,
        has_manual_uploads: data.has_manual_uploads ?? false,
      };
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    if (feedsQuery.data) setFeeds(feedsQuery.data);
  }, [feedsQuery.data]);

  useEffect(() => {
    if (coverageQuery.data) setHasManualUploads(coverageQuery.data.has_manual_uploads);
  }, [coverageQuery.data]);

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
      selectedSpeaker,
      page,
      pageSize,
      viewMode,
    });
  }, [query, submittedQuery, selectedFeedIds, selectedSpeaker, page, pageSize, viewMode]);

  // Separate real feed UUIDs from the __uploads__ sentinel
  const includeManualUploads = selectedFeedIds.has("__uploads__");
  const feedFilterParam = Array.from(selectedFeedIds)
    .filter((id) => id !== "__uploads__")
    .join(",");

  // Flat search query
  const flatCacheKey = `${submittedQuery}:${feedFilterParam}:${includeManualUploads}:${selectedSpeaker}:${pageSize}`;
  const flatQuery = useQuery<SearchPageType>({
    queryKey: ["search", submittedQuery, feedFilterParam, includeManualUploads, selectedSpeaker, page, pageSize],
    queryFn: async () => {
      if (!submittedQuery)
        return {
          results: [],
          total: 0,
          page: 1,
          pageSize,
          coverage: { processed: 0, total: 0 },
        };
      const canSkipCount =
        page > 1 && cachedFlatTotal.current?.key === flatCacheKey;
      const params = new URLSearchParams({
        q: submittedQuery,
        page: String(page),
        pageSize: String(pageSize),
      });
      if (feedFilterParam) params.set("feedId", feedFilterParam);
      if (includeManualUploads) params.set("uploads", "true");
      if (selectedSpeaker) params.set("speaker", selectedSpeaker);
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
  const groupedCacheKey = `${submittedQuery}:${feedFilterParam}:${includeManualUploads}:${selectedSpeaker}:${pageSize}`;
  const groupedQuery = useQuery<GroupedSearchResult>({
    queryKey: ["search-grouped", submittedQuery, feedFilterParam, includeManualUploads, selectedSpeaker, page, pageSize],
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
        pageSize: String(pageSize),
      });
      if (feedFilterParam) params.set("feedId", feedFilterParam);
      if (includeManualUploads) params.set("uploads", "true");
      if (selectedSpeaker) params.set("speaker", selectedSpeaker);
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
    setSelectedSpeaker(null);
    router.replace("/search", { scroll: false });
  }

  const isLoading =
    viewMode === "flat"
      ? flatQuery.isLoading || flatQuery.isFetching
      : groupedQuery.isLoading || groupedQuery.isFetching;

  const totalPages =
    viewMode === "flat" && flatQuery.data
      ? Math.ceil(flatQuery.data.total / pageSize)
      : 0;
  const groupedTotalPages =
    viewMode === "grouped" && groupedQuery.data
      ? Math.ceil(groupedQuery.data.totalEpisodes / pageSize)
      : 0;

  return (
    <div className="space-y-6">
      <SearchTopPanel
        submittedQuery={submittedQuery}
        query={query}
        onQueryChange={setQuery}
        onSubmit={handleSubmit}
        onClear={handleClear}
        coverage={coverageQuery.data ? { processed: coverageQuery.data.processed, total: coverageQuery.data.total } : null}
        feeds={feeds}
        selectedFeedIds={selectedFeedIds}
        onFeedSelectionChange={(next) => {
          setSelectedFeedIds(next);
          setSelectedSpeaker(null);
          setPage(1);
        }}
        hasManualUploads={hasManualUploads}
        feedsLoading={feedsQuery.isLoading}
        includeManualUploads={includeManualUploads}
        selectedSpeaker={selectedSpeaker}
        onSpeakerSelectionChange={(s) => {
          setSelectedSpeaker(s);
          setPage(1);
        }}
      />

      {/* Search spinner */}
      {submittedQuery && isLoading && (
        <SearchSpinner label="Searching..." />
      )}

      {submittedQuery && !isLoading && (
        <div className="space-y-4">
          <SearchResultsToolbar
            viewMode={viewMode}
            onViewModeChange={(mode) => {
              setViewMode(mode);
              setPage(1);
            }}
            pageSize={pageSize}
            onPageSizeChange={(next) => {
              setPageSize(isValidPageSize(next) ? next : DEFAULT_PAGE_SIZE);
              setPage(1);
            }}
            summaryText={
              viewMode === "grouped" && groupedQuery.data
                ? `Found in ${groupedQuery.data.totalFeeds} podcast${groupedQuery.data.totalFeeds !== 1 ? "s" : ""}, ${groupedQuery.data.totalEpisodes} episode${groupedQuery.data.totalEpisodes !== 1 ? "s" : ""} (${groupedQuery.data.totalMentions} mention${groupedQuery.data.totalMentions !== 1 ? "s" : ""})`
                : viewMode === "flat" && flatQuery.data
                  ? `Page ${page} of ${totalPages} · ${flatQuery.data.total} results`
                  : ""
            }
            coverageText={(() => {
              const cov =
                viewMode === "grouped"
                  ? groupedQuery.data?.coverage
                  : flatQuery.data?.coverage;
              if (cov && cov.total > 0 && cov.processed < cov.total) {
                return ` · Searching ${cov.processed} of ${cov.total} episodes`;
              }
              return null;
            })()}
            submittedQuery={submittedQuery}
            flatData={flatQuery.data}
            groupedData={groupedQuery.data}
          />

          {viewMode === "grouped" ? (
            groupedQuery.data && groupedQuery.data.feeds.length > 0 ? (
              <>
                <div className="space-y-3">
                  {groupedQuery.data.feeds.map((feed) => (
                    <FeedGroupCard
                      key={feed.feedId}
                      feed={feed}
                      query={submittedQuery}
                    />
                  ))}
                </div>
                {groupedTotalPages > 1 && (
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
                      Page {page} of {groupedTotalPages}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setPage((p) => Math.min(groupedTotalPages, p + 1))}
                      disabled={page === groupedTotalPages}
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
