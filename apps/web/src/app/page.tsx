"use client";

import { useState, useCallback } from "react";
import { Search } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import SearchResult from "@/components/SearchResult";
import type { SearchPage } from "@/lib/search";

const PAGE_SIZE = 20;

export default function HomePage() {
  const [query, setQuery] = useState("");
  const [submittedQuery, setSubmittedQuery] = useState("");
  const [feedFilter, setFeedFilter] = useState<string>("");
  const [page, setPage] = useState(1);

  const { data, isLoading, isFetching } = useQuery<SearchPage>({
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
    enabled: Boolean(submittedQuery),
    staleTime: 30_000,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setPage(1);
    setSubmittedQuery(query.trim());
  }

  const totalPages = data ? Math.ceil(data.total / PAGE_SIZE) : 0;

  return (
    <div className="space-y-6">
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
            className="w-full pl-10 pr-4 py-3 border border-input rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring text-base"
            autoFocus
          />
        </div>
      </form>

      {submittedQuery && (
        <div className="space-y-4">
          {isLoading || isFetching ? (
            // Skeleton loading state
            <div className="space-y-3">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="border border-border rounded-lg p-4 space-y-2 animate-pulse">
                  <div className="h-4 bg-muted rounded w-2/3" />
                  <div className="h-3 bg-muted rounded w-1/3" />
                  <div className="h-3 bg-muted rounded w-full" />
                  <div className="h-3 bg-muted rounded w-5/6" />
                </div>
              ))}
            </div>
          ) : data && data.results.length > 0 ? (
            <>
              <div className="text-sm text-muted-foreground">
                Page {page} of {totalPages} · {data.total} results
              </div>

              <div className="space-y-3">
                {data.results.map((result) => (
                  <SearchResult key={result.id} result={result} />
                ))}
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-2">
                  <button
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    disabled={page === 1}
                    className="text-sm px-3 py-1.5 border border-border rounded disabled:opacity-40"
                  >
                    ← Previous
                  </button>
                  <span className="text-sm text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <button
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    disabled={page === totalPages}
                    className="text-sm px-3 py-1.5 border border-border rounded disabled:opacity-40"
                  >
                    Next →
                  </button>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16 space-y-2">
              <p className="text-muted-foreground">No results for "{submittedQuery}"</p>
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
