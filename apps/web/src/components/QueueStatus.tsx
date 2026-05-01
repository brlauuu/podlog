"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import {
  ACTIVE_STATUSES,
  computeQueueViewModel,
  ERROR_LABELS,
  NON_RETRYABLE,
  STAGES,
  type Job,
  type QueueState,
} from "@/lib/queueStatus";

// --- Helpers ---

function timeAgo(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (isNaN(ms)) return "—";
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.floor(hr / 24)}d ago`;
}

function useDebounce(value: string, delay: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(id);
  }, [value, delay]);
  return debounced;
}

// --- Sub-components ---

function StageBar({
  counts,
  activeFilter,
  onFilterChange,
}: {
  counts: Record<string, number>;
  activeFilter: string | null;
  onFilterChange: (stage: string | null) => void;
}) {
  return (
    <div className="flex gap-0.5 rounded-lg overflow-hidden">
      {STAGES.map((s) => {
        const count = counts[s.key] || 0;
        const dimmed = count === 0 && activeFilter !== s.key;
        const isActive = activeFilter === s.key;
        return (
          <button
            key={s.key}
            className="flex-1 text-center py-2 px-1 transition-all"
            style={{
              background: isActive ? s.color : s.bg,
              opacity: dimmed ? 0.4 : activeFilter && !isActive ? 0.5 : 1,
              boxShadow: isActive ? `0 0 0 2px ${s.color}` : "none",
              cursor: count > 0 || isActive ? "pointer" : "default",
            }}
            onClick={() => onFilterChange(isActive ? null : s.key)}
          >
            <div
              className="text-sm font-semibold"
              style={{ color: isActive ? "#fff" : s.color }}
            >
              {count}
            </div>
            <div
              className="text-[10px] truncate"
              style={{ color: isActive ? "rgba(255,255,255,0.8)" : undefined }}
            >
              <span className={isActive ? "" : "text-muted-foreground"}>{s.label}</span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const stage = STAGES.find((s) => s.key === status);
  const color = stage?.color ?? "#888";
  const isActive = ACTIVE_STATUSES.has(status);
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium text-white ${
        isActive ? "animate-pulse" : ""
      }`}
      style={{ backgroundColor: color }}
    >
      {status.toUpperCase()}
    </span>
  );
}

function EpisodeRow({
  job,
  onRetry,
  onPodcastClick,
  onStageClick,
}: {
  job: Job;
  onRetry: (episodeId: string) => void;
  onPodcastClick: (feedTitle: string) => void;
  onStageClick: (stage: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFailed = job.status === "failed";
  const isStuck = job.status === "stuck";
  const canRetry =
    (isFailed || isStuck) &&
    !NON_RETRYABLE.has(job.error_class ?? "");

  return (
    <>
      <tr
        className={`border-b border-border hover:bg-muted/50 ${
          isFailed ? "bg-destructive/5 cursor-pointer" : isStuck ? "bg-purple-500/5 cursor-pointer" : ""
        }`}
        onClick={isFailed || isStuck ? () => setExpanded(!expanded) : undefined}
      >
        <td className="px-3 py-2 text-sm">
          <Link
            href={`/episodes/${job.episode_id}`}
            className="hover:text-link hover:underline transition-colors"
            onClick={(e) => e.stopPropagation()}
          >
            {job.title ?? "Untitled"}
          </Link>
        </td>
        <td className="px-3 py-2 text-sm text-muted-foreground hidden sm:table-cell">
          {job.feed_title ? (
            <button
              className="hover:text-primary hover:underline transition-colors text-left"
              onClick={(e) => {
                e.stopPropagation();
                onPodcastClick(job.feed_title!);
              }}
            >
              {job.feed_title}
            </button>
          ) : (
            "—"
          )}
          {job.feed_mode === "test" && (
            <span className="ml-1 text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1 rounded">
              Test
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              onStageClick(job.status);
            }}
          >
            <StatusBadge status={job.status} />
          </button>
        </td>
        <td className="px-3 py-2 text-sm text-muted-foreground">
          {timeAgo(job.updated_at)}
        </td>
        <td className="px-3 py-2 text-sm text-muted-foreground hidden sm:table-cell">
          {job.retry_count > 0
            ? `${job.retry_count}/${job.retry_max}`
            : "—"}
        </td>
      </tr>
      {isFailed && expanded && (
        <tr className="border-b border-border bg-destructive/5">
          <td colSpan={5} className="px-3 py-3">
            <div className="text-sm space-y-1">
              <div className="font-medium text-destructive">
                {ERROR_LABELS[job.error_class ?? ""] ?? job.error_class ?? "Unknown error"}
              </div>
              {job.error_message && (
                <div className="text-xs text-muted-foreground font-mono whitespace-pre-wrap">
                  {job.error_message}
                </div>
              )}
              {canRetry && (
                <button
                  className="mt-2 px-3 py-1 text-xs bg-action text-action-foreground rounded hover:bg-action/90"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(job.episode_id);
                  }}
                >
                  Retry
                </button>
              )}
              {isFailed && NON_RETRYABLE.has(job.error_class ?? "") && (
                <div className="text-xs text-muted-foreground italic">
                  Cannot retry — {ERROR_LABELS[job.error_class!]}
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function TableHeader() {
  return (
    <thead>
      <tr className="border-b border-border bg-muted/50">
        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
          Episode
        </th>
        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
          Podcast
        </th>
        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
          Stage
        </th>
        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
          Updated
        </th>
        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground hidden sm:table-cell">
          Retries
        </th>
      </tr>
    </thead>
  );
}

// --- Main Component ---

export default function QueueStatus() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [search, setSearch] = useState("");
  const [showDone, setShowDone] = useState(false);
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const debouncedSearch = useDebounce(search, 300);

  useEffect(() => {
    async function fetchQueue() {
      try {
        const res = await fetch("/api/queue");
        if (res.ok) setQueue(await res.json());
      } catch (_) {}
    }
    fetchQueue();
    const id = setInterval(fetchQueue, 5000);
    return () => clearInterval(id);
  }, []);

  if (!queue) {
    return <div className="text-muted-foreground text-sm">Loading queue...</div>;
  }

  const { counts, filtered, filteredDone, effectiveShowDone, isEmpty } = computeQueueViewModel({
    queue,
    search: debouncedSearch,
    stageFilter,
    showDone,
  });
  const activeCount = queue.active_count;
  const failedCount = queue.failed_count;
  const doneCount = queue.done_count;
  const stuckCount = queue.stuck_count ?? 0;

  async function handleRetry(episodeId: string) {
    try {
      const res = await fetch(`/api/pipeline/queue/${episodeId}/retry`, { method: "POST" });
      if (!res.ok) {
        console.error("Retry failed with status", res.status);
      }
    } catch (err) {
      console.error("Retry request failed", err);
    }
  }

  const q = debouncedSearch.toLowerCase();

  return (
    <div className="space-y-4">
      <StageBar counts={counts} activeFilter={stageFilter} onFilterChange={setStageFilter} />

      {/* Search bar + summary */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search episodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {activeCount} active · {failedCount} failed{stuckCount > 0 ? ` · ${stuckCount} stuck` : ""} · {doneCount} done
        </span>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No episodes in the queue.</p>
          <p className="text-sm mt-1">
            <Link href="/feeds" className="text-link hover:underline">
              Add a feed
            </Link>{" "}
            to get started.
          </p>
        </div>
      )}

      {/* Active filter indicator */}
      {stageFilter && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">
            Filtering by <b>{stageFilter}</b>
          </span>
          <button
            className="text-xs text-link hover:underline"
            onClick={() => setStageFilter(null)}
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Episode table */}
      {!isEmpty && filtered.length === 0 && (q || stageFilter) && stageFilter !== "done" && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No episodes match {stageFilter ? `"${stageFilter}" filter` : "your search"}.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="rounded-lg border border-border overflow-hidden">
          <table className="w-full">
            <TableHeader />
            <tbody>
              {filtered.map((job) => (
                <EpisodeRow
                  key={job.episode_id}
                  job={job}
                  onRetry={handleRetry}
                  onPodcastClick={(title) => setSearch(title)}
                  onStageClick={(stage) => setStageFilter(stageFilter === stage ? null : stage)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Done section */}
      {doneCount > 0 && (
        <div>
          <button
            onClick={() => { setShowDone(!effectiveShowDone); if (stageFilter === "done") setStageFilter(null); }}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {effectiveShowDone ? "Hide" : "Show"} {doneCount} completed episode{doneCount !== 1 ? "s" : ""}{" "}
            {effectiveShowDone ? "▴" : "▾"}
          </button>
          {effectiveShowDone && filteredDone.length > 0 && (
            <div className="mt-2 rounded-lg border border-border overflow-hidden">
              <table className="w-full">
                <TableHeader />
                <tbody>
                  {filteredDone.map((job) => (
                    <EpisodeRow
                      key={job.episode_id}
                      job={job}
                      onRetry={handleRetry}
                      onPodcastClick={(title) => setSearch(title)}
                      onStageClick={(stage) => setStageFilter(stageFilter === stage ? null : stage)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {effectiveShowDone && filteredDone.length === 0 && (q || stageFilter) && (
            <div className="mt-2 text-center py-4 text-muted-foreground text-sm">
              No completed episodes match your search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
