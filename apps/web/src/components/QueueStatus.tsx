"use client";

import { useState, useEffect } from "react";
import Link from "next/link";

// --- Types ---

interface Job {
  episode_id: string;
  title: string | null;
  status: string;
  celery_task_id: string | null;
  error_message: string | null;
  error_class: string | null;
  retry_count: number;
  retry_max: number;
  feed_mode: string | null;
  feed_title: string | null;
  updated_at: string | null;
}

interface QueueState {
  active_count: number;
  pending_count: number;
  failed_count: number;
  done_count: number;
  active_jobs: Job[];
  pending_jobs: Job[];
  failed_jobs: Job[];
  done_jobs: Job[];
}

// --- Constants ---

const STAGES = [
  { key: "pending", label: "Pending", color: "#eab308", bg: "rgba(234,179,8,0.15)" },
  { key: "downloading", label: "Downloading", color: "#06b6d4", bg: "rgba(6,182,212,0.15)" },
  { key: "transcribing", label: "Transcribing", color: "#2563eb", bg: "rgba(37,99,235,0.15)" },
  { key: "diarizing", label: "Diarizing", color: "#7c3aed", bg: "rgba(124,58,237,0.15)" },
  { key: "inferring", label: "Inferring", color: "#f97316", bg: "rgba(249,115,22,0.15)" },
  { key: "archiving", label: "Archiving", color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
  { key: "done", label: "Done", color: "#16a34a", bg: "rgba(22,163,74,0.15)" },
  { key: "failed", label: "Failed", color: "#dc2626", bg: "rgba(220,38,38,0.15)" },
] as const;

const ACTIVE_STATUSES = new Set([
  "downloading", "transcribing", "diarizing", "inferring", "archiving",
]);

const NON_RETRYABLE = new Set(["DISK_FULL", "OOM"]);

const ERROR_LABELS: Record<string, string> = {
  TRANSIENT_NETWORK: "Network error",
  HTTP_ACCESS: "Access error",
  DISK_FULL: "Disk full — free space and retry",
  OOM: "Out of memory — check hardware requirements",
  SYSTEM_ERROR: "Unexpected error",
};

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

function sortByUpdated(jobs: Job[]): Job[] {
  return [...jobs].sort(
    (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  );
}

function stageCounts(queue: QueueState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of STAGES) counts[s.key] = 0;
  const allJobs = [...queue.active_jobs, ...queue.pending_jobs, ...queue.failed_jobs];
  for (const j of allJobs) counts[j.status] = (counts[j.status] || 0) + 1;
  counts["done"] = queue.done_count;
  return counts;
}

// --- Sub-components ---

function StageBar({ counts }: { counts: Record<string, number> }) {
  return (
    <div className="flex gap-0.5 rounded-lg overflow-hidden">
      {STAGES.map((s) => {
        const count = counts[s.key] || 0;
        const dimmed = count === 0;
        return (
          <div
            key={s.key}
            className="flex-1 text-center py-2 px-1"
            style={{
              background: s.bg,
              opacity: dimmed ? 0.4 : 1,
            }}
          >
            <div className="text-sm font-semibold" style={{ color: s.color }}>
              {count}
            </div>
            <div className="text-[10px] text-muted-foreground truncate">
              {s.label}
            </div>
          </div>
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
}: {
  job: Job;
  onRetry: (taskId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const isFailed = job.status === "failed";
  const canRetry =
    isFailed &&
    job.celery_task_id &&
    !NON_RETRYABLE.has(job.error_class ?? "");

  return (
    <>
      <tr
        className={`border-b border-border hover:bg-muted/50 ${
          isFailed ? "bg-destructive/5 cursor-pointer" : ""
        }`}
        onClick={isFailed ? () => setExpanded(!expanded) : undefined}
      >
        <td className="px-3 py-2 text-sm">
          {job.title ?? "Untitled"}
        </td>
        <td className="px-3 py-2 text-sm text-muted-foreground hidden sm:table-cell">
          {job.feed_title ?? "—"}
          {job.feed_mode === "test" && (
            <span className="ml-1 text-[10px] bg-yellow-500/20 text-yellow-600 dark:text-yellow-400 px-1 rounded">
              Test
            </span>
          )}
        </td>
        <td className="px-3 py-2">
          <StatusBadge status={job.status} />
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
                  className="mt-2 px-3 py-1 text-xs bg-primary text-primary-foreground rounded hover:bg-primary/90"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRetry(job.celery_task_id!);
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

  const counts = stageCounts(queue);
  const activeCount = queue.active_count;
  const failedCount = queue.failed_count;
  const doneCount = queue.done_count;

  // Merge and sort: failed first (by updated_at desc), then active, then pending
  const allJobs = [
    ...sortByUpdated(queue.failed_jobs),
    ...sortByUpdated(queue.active_jobs),
    ...sortByUpdated(queue.pending_jobs),
  ];

  // Search filter (debounced)
  const q = debouncedSearch.toLowerCase();
  const matchesSearch = (j: Job) =>
    (j.title ?? "").toLowerCase().includes(q) ||
    (j.feed_title ?? "").toLowerCase().includes(q);

  const filtered = q ? allJobs.filter(matchesSearch) : allJobs;
  const filteredDone = q ? queue.done_jobs.filter(matchesSearch) : queue.done_jobs;

  async function handleRetry(taskId: string) {
    try {
      const res = await fetch(`/api/pipeline/queue/${taskId}/retry`, { method: "POST" });
      if (!res.ok) {
        console.error("Retry failed with status", res.status);
      }
    } catch (err) {
      console.error("Retry request failed", err);
    }
  }

  const isEmpty = allJobs.length === 0 && doneCount === 0;

  return (
    <div className="space-y-4">
      <StageBar counts={counts} />

      {/* Search bar + summary */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search episodes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-3 py-1.5 text-sm rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
        />
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {activeCount} active · {failedCount} failed · {doneCount} done
        </span>
      </div>

      {/* Empty state */}
      {isEmpty && (
        <div className="text-center py-12 text-muted-foreground">
          <p>No episodes in the queue.</p>
          <p className="text-sm mt-1">
            <Link href="/feeds" className="text-primary hover:underline">
              Add a feed
            </Link>{" "}
            to get started.
          </p>
        </div>
      )}

      {/* Episode table */}
      {!isEmpty && filtered.length === 0 && q && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No episodes match your search.
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
            onClick={() => setShowDone(!showDone)}
            className="text-sm text-muted-foreground hover:text-foreground"
          >
            {showDone ? "Hide" : "Show"} {doneCount} completed episode{doneCount !== 1 ? "s" : ""}{" "}
            {showDone ? "▴" : "▾"}
          </button>
          {showDone && filteredDone.length > 0 && (
            <div className="mt-2 rounded-lg border border-border overflow-hidden">
              <table className="w-full">
                <TableHeader />
                <tbody>
                  {filteredDone.map((job) => (
                    <EpisodeRow
                      key={job.episode_id}
                      job={job}
                      onRetry={handleRetry}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {showDone && filteredDone.length === 0 && q && (
            <div className="mt-2 text-center py-4 text-muted-foreground text-sm">
              No completed episodes match your search.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
