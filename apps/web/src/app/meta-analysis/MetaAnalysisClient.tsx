"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SnapshotResponse } from "@/lib/metaAnalysisTypes";

async function fetchSnapshot(): Promise<SnapshotResponse> {
  const r = await fetch("/api/meta-analysis/snapshot", { cache: "no-store" });
  if (!r.ok) throw new Error("failed");
  return r.json();
}

async function refreshSnapshot(): Promise<SnapshotResponse> {
  const r = await fetch("/api/meta-analysis/refresh", { method: "POST" });
  if (!r.ok) throw new Error("refresh failed");
  return r.json();
}

export default function MetaAnalysisClient() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["meta-analysis-snapshot"],
    queryFn: fetchSnapshot,
  });
  const refresh = useMutation({
    mutationFn: refreshSnapshot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meta-analysis-snapshot"] }),
  });

  const snap = data?.snapshot ?? null;

  if (isLoading) return <p className="text-muted-foreground">Loading meta-analysis…</p>;
  if (isError) return <p className="text-red-500">Could not load meta-analysis.</p>;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Meta-analysis</h1>
          <p className="text-sm text-muted-foreground">
            {data?.computed_at
              ? `Updated ${new Date(data.computed_at).toLocaleString()}`
              : "Never computed"}
            {data?.is_stale ? " · refresh pending" : ""}
          </p>
        </div>
        <button
          className="px-3 py-1.5 rounded-md border text-sm"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
        >
          {refresh.isPending ? "Refreshing…" : "↻ Refresh"}
        </button>
      </header>

      {!snap ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No analysis yet — hit ↻ Refresh or wait for the queue to drain.
        </div>
      ) : (
        <>
          {/* Coverage strip + chart grid are added by later tasks. */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <div className="p-4 border rounded-md text-sm text-muted-foreground">
              {snap.per_feed.length} podcasts · {data?.episode_count} episodes processed
            </div>
          </div>
        </>
      )}
    </div>
  );
}
