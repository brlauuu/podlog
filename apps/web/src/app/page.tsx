"use client";

import { useState } from "react";
import { Search, List, Layers } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import SearchResult from "@/components/SearchResult";
import FeedGroupCard from "@/components/FeedGroupCard";
import DownloadReportButton from "@/components/DownloadReportButton";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import type { SearchPage, GroupedSearchResult } from "@/lib/search";

const PAGE_SIZE = 20;

type ViewMode = "grouped" | "flat";

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState<string>("");
  const [page, setPage] = useState(1);
  const [viewMode, setViewMode] = useState<ViewMode>("grouped");

  // Flat search query
  const flatQuery = useQuery<SearchPage>({
    queryKey: ["search", submittedQuery, feedFilter, page],
    queryFn: async () => {
      if (!submittedQuery) return { results: [], total: 0, page: 1, pageSize: PAGE_SIZE };
      const params = new URLSearchParams({
        q: submittedQuery,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (feedFilter) params.set("feedId", feedFilter);
      const resp = await fetch(`/api/search?${params}`);
      if (!resp.ok) throw new Error("Search failed");
      return resp.json();
    },
    enabled: Boolean(submittedQuery) && viewMode === "flat",
    staleTime: 30_000,
  });

  // Grouped search query
  const groupedQuery = useQuery<GroupedSearchResult>({
    queryKey: ["search-grouped", submittedQuery, feedFilter, page],
    queryFn: async () => {
      if (!submittedQuery)
        return { feeds: [], totalFeeds: 0, totalEpisodes: 0, totalMentions: 0 };
      const params = new URLSearchParams({
        q: submittedQuery,
        page: String(page),
        pageSize: String(PAGE_SIZE),
      });
      if (feedFilter) params.set("feedId", feedFilter);
      const resp = await fetch(`/api/search/grouped?${params}`);
      if (!resp.ok) throw new Error("Search failed");
      return resp.json();
    },
    enabled: Boolean(submittedQuery) && viewMode === "grouped",
    staleTime: 30_000,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSubmittedQuery(query.trim());
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
      {!submittedQuery && (
        <div className="text-center py-8 space-y-2">
          <h1 className="text-3xl font-bold tracking-tight">Podlog</h1>
          <p className="text-muted-foreground">
            Self-hosted podcast transcription and search
          </p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-3">
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
            className="w-full pl-10 pr-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base transition-shadow"
            autoFocus
          />
        </div>
      </form>

      {submittedQuery && (
        <div className="space-y-4">
          {/* View mode toggle */}
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {viewMode === "grouped" && groupedQuery.data
                ? `Found in ${groupedQuery.data.totalFeeds} podcast${groupedQuery.data.totalFeeds !== 1 ? "s" : ""}, ${groupedQuery.data.totalEpisodes} episode${groupedQuery.data.totalEpisodes !== 1 ? "s" : ""} (${groupedQuery.data.totalMentions} mention${groupedQuery.data.totalMentions !== 1 ? "s" : ""})`
                : viewMode === "flat" && flatQuery.data
                  ? `Page ${page} of ${totalPages} · ${flatQuery.data.total} results`
                  : ""}
            </div>
            <div className="flex items-center gap-2">
              <DownloadReportButton
                query={submittedQuery}
                viewMode={viewMode}
                flatResults={viewMode === "flat" ? flatQuery.data?.results : undefined}
                groupedResults={viewMode === "grouped" ? groupedQuery.data : undefined}
              />
              <div className="flex items-center border border-border rounded-lg overflow-hidden">
                <button
                  onClick={() => { setViewMode("grouped"); setPage(1); }}
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
                  onClick={() => { setViewMode("flat"); setPage(1); }}
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

          {isLoading ? (
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border border-border rounded-lg p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <Skeleton className="h-4 w-32" />
                    <Skeleton className="h-4 w-48" />
                  </div>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-5/6" />
                </div>
              ))}
            </div>
          ) : viewMode === "grouped" ? (
            // Grouped view
            groupedQuery.data && groupedQuery.data.feeds.length > 0 ? (
              <div className="space-y-3">
                {groupedQuery.data.feeds.map((feed) => (
                  <FeedGroupCard key={feed.feedId} feed={feed} query={submittedQuery} />
                ))}
              </div>
            ) : (
              <div className="text-center py-16 space-y-2">
                <p className="text-muted-foreground">No results for &ldquo;{submittedQuery}&rdquo;</p>
                <p className="text-sm text-muted-foreground">
                  Try checking your spelling, or use broader search terms.
                </p>
              </div>
            )
          ) : (
            // Flat view
            flatQuery.data && flatQuery.data.results.length > 0 ? (
              <>
                <div className="space-y-3">
                  {flatQuery.data.results.map((result) => (
                    <SearchResult key={result.id} result={result} />
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
                <p className="text-muted-foreground">No results for &ldquo;{submittedQuery}&rdquo;</p>
                <p className="text-sm text-muted-foreground">
                  Try checking your spelling, or use broader search terms.
                </p>
              </div>
            )
          )}
        </div>
      )}
    </div>
  );
}
