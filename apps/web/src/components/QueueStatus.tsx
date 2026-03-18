"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { RefreshCw, ChevronDown, ChevronRight, FlaskConical, LayoutList, Kanban } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
  updated_at?: string | null;
}

interface QueueState {
  active_count: number;
  pending_count: number;
  failed_count: number;
  active_jobs: Job[];
  pending_jobs: Job[];
  failed_jobs: Job[];
}

type GroupMode = "status" | "podcast" | "stage";
type ViewStyle = "list" | "board";

const GROUP_MODE_LABELS: Record<GroupMode, string> = {
  status: "By Status",
  podcast: "By Podcast",
  stage: "By Processing Stage",
};

const ERROR_CLASS_LABELS: Record<string, string> = {
  TRANSIENT_NETWORK: "Network error",
  HTTP_ACCESS: "Access error",
  DISK_FULL: "Disk full — free space and retry",
  OOM: "Out of memory — check hardware requirements",
  SYSTEM_ERROR: "Unexpected error",
};

const NON_RETRYABLE = ["DISK_FULL", "OOM"];

const STATUS_BADGE_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  pending: "secondary",
  downloading: "default",
  transcribing: "default",
  diarizing: "default",
  inferring: "default",
  archiving: "default",
  done: "outline",
  failed: "destructive",
};

/** Ordered stages for the Kanban board — per issue #44 */
const STAGE_ORDER = ["pending", "downloading", "transcribing", "diarizing", "inferring", "archiving", "done", "failed"];

const STAGE_LABELS: Record<string, string> = {
  pending: "Pending",
  downloading: "Downloading",
  transcribing: "Transcribing",
  diarizing: "Diarizing",
  inferring: "Inferring",
  archiving: "Archiving",
  done: "Done",
  failed: "Failed",
};

/** Status order for the "By Status" Kanban board — per issue #44 */
const STATUS_ORDER = ["pending", "active", "done", "failed"];

const STATUS_LABELS: Record<string, string> = {
  pending: "Pending",
  active: "Active",
  done: "Done",
  failed: "Failed",
};

/** Subtle background colors for Kanban column headers */
const COLUMN_COLORS: Record<string, string> = {
  pending: "bg-slate-100 dark:bg-slate-800/50",
  active: "bg-blue-50 dark:bg-blue-950/40",
  downloading: "bg-sky-50 dark:bg-sky-950/40",
  transcribing: "bg-indigo-50 dark:bg-indigo-950/40",
  diarizing: "bg-violet-50 dark:bg-violet-950/40",
  inferring: "bg-purple-50 dark:bg-purple-950/40",
  archiving: "bg-teal-50 dark:bg-teal-950/40",
  done: "bg-green-50 dark:bg-green-950/40",
  failed: "bg-red-50 dark:bg-red-950/40",
};

const COLUMN_BORDER_COLORS: Record<string, string> = {
  pending: "border-slate-200 dark:border-slate-700",
  active: "border-blue-200 dark:border-blue-800",
  downloading: "border-sky-200 dark:border-sky-800",
  transcribing: "border-indigo-200 dark:border-indigo-800",
  diarizing: "border-violet-200 dark:border-violet-800",
  inferring: "border-purple-200 dark:border-purple-800",
  archiving: "border-teal-200 dark:border-teal-800",
  done: "border-green-200 dark:border-green-800",
  failed: "border-red-200 dark:border-red-800",
};

const STORAGE_KEY = "podlog-queue-grouping";
const VIEW_STYLE_KEY = "podlog-queue-view-style";

function getStoredGroupMode(): GroupMode {
  if (typeof window === "undefined") return "status";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "status" || stored === "podcast" || stored === "stage") return stored;
  return "status";
}

function getStoredViewStyle(): ViewStyle {
  if (typeof window === "undefined") return "list";
  const stored = localStorage.getItem(VIEW_STYLE_KEY);
  if (stored === "list" || stored === "board") return stored;
  return "list";
}

/** Active statuses that should show a pulse animation on the board */
const ACTIVE_STATUSES = new Set(["downloading", "transcribing", "diarizing", "inferring", "archiving"]);

function isActiveJob(job: Job): boolean {
  return ACTIVE_STATUSES.has(job.status);
}

/** Format relative time since a given ISO timestamp */
function timeAgo(isoDate: string | null | undefined): string | null {
  if (!isoDate) return null;
  const then = new Date(isoDate).getTime();
  if (isNaN(then)) return null;
  const diffMs = Date.now() - then;
  const diffSec = Math.floor(diffMs / 1000);
  if (diffSec < 60) return `${diffSec}s ago`;
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.floor(diffHr / 24);
  return `${diffDay}d ago`;
}

function StatusBadge({ status }: { status: string }) {
  return (
    <Badge variant={STATUS_BADGE_VARIANT[status] ?? "outline"} className="text-[10px] px-1.5 py-0">
      {status}
    </Badge>
  );
}

function JobCard({ job, onRetry, showStatus }: { job: Job; onRetry: (taskId: string) => void; showStatus?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const canRetry = job.celery_task_id && !NON_RETRYABLE.includes(job.error_class ?? "");

  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-sm font-medium">{job.title ?? job.episode_id}</span>
            {showStatus && <StatusBadge status={job.status} />}
            {job.feed_mode === "test" && (
              <Badge variant="outline" className="text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-0.5 text-[10px] px-1 py-0">
                <FlaskConical size={9} />
                Test
              </Badge>
            )}
          </div>
          {job.status === "failed" && (
            <button
              onClick={() => canRetry && job.celery_task_id && onRetry(job.celery_task_id)}
              disabled={!canRetry}
              title={!canRetry ? "Cannot retry — resolve the underlying issue first" : undefined}
              className="text-xs px-2.5 py-1 rounded-md bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
            >
              Retry
            </button>
          )}
        </div>

        {job.error_class && (
          <Badge variant="destructive" className="text-xs">
            {ERROR_CLASS_LABELS[job.error_class] ?? job.error_class}
          </Badge>
        )}

        {job.error_message && (
          <div>
            <button
              onClick={() => setExpanded((e) => !e)}
              className="text-xs text-muted-foreground flex items-center gap-1 hover:text-foreground transition-colors"
            >
              <ChevronDown size={12} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
              Error detail
            </button>
            {expanded && (
              <pre className="mt-1 text-xs bg-muted rounded-md p-2 overflow-x-auto whitespace-pre-wrap">
                {job.error_message}
              </pre>
            )}
          </div>
        )}

        {job.status !== "failed" && job.status !== "pending" && (
          <div className="text-xs text-muted-foreground flex items-center gap-1.5">
            {job.status === "inferring" ? (
              <>
                <span className="inline-block h-3 w-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
                Inferring speakers...
              </>
            ) : (
              job.status
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/** Compact card for the Kanban board view — per issue #44 */
function BoardCard({ job, onRetry }: { job: Job; onRetry: (taskId: string) => void }) {
  const canRetry = job.celery_task_id && !NON_RETRYABLE.includes(job.error_class ?? "");
  const active = isActiveJob(job);
  const elapsed = timeAgo(job.updated_at);

  return (
    <div
      className={`rounded-lg border bg-card text-card-foreground p-2.5 space-y-1 transition-all ${
        active ? "ring-1 ring-blue-400/50 dark:ring-blue-500/30 animate-pulse-subtle" : ""
      }`}
    >
      <div className="flex items-start justify-between gap-1.5">
        <p className="text-sm font-medium leading-tight line-clamp-2">
          {job.title ?? job.episode_id}
        </p>
        {job.status === "failed" && (
          <button
            onClick={() => canRetry && job.celery_task_id && onRetry(job.celery_task_id)}
            disabled={!canRetry}
            title={!canRetry ? "Cannot retry — resolve the underlying issue first" : undefined}
            className="shrink-0 text-[10px] px-1.5 py-0.5 rounded bg-primary text-primary-foreground disabled:opacity-40 disabled:cursor-not-allowed hover:opacity-90 transition-opacity"
          >
            Retry
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap">
        {job.feed_title && (
          <span className="text-[11px] text-muted-foreground truncate max-w-[140px]">
            {job.feed_title}
          </span>
        )}
        {job.feed_mode === "test" && (
          <Badge variant="outline" className="text-violet-700 border-violet-300 dark:text-violet-300 dark:border-violet-700 gap-0.5 text-[10px] px-1 py-0">
            <FlaskConical size={8} />
            Test
          </Badge>
        )}
      </div>

      <div className="flex items-center justify-between gap-1">
        {job.error_class && (
          <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
            {ERROR_CLASS_LABELS[job.error_class] ?? job.error_class}
          </Badge>
        )}
        {elapsed && (
          <span className="text-[10px] text-muted-foreground ml-auto">{elapsed}</span>
        )}
      </div>
    </div>
  );
}

interface CollapsibleGroupProps {
  label: string;
  count: number;
  emptyMessage: string;
  jobs: Job[];
  onRetry: (taskId: string) => void;
  showStatus?: boolean;
  defaultOpen?: boolean;
}

function CollapsibleGroup({ label, count, emptyMessage, jobs, onRetry, showStatus, defaultOpen = true }: CollapsibleGroupProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <section>
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 mb-2 group cursor-pointer w-full text-left"
      >
        {open ? <ChevronDown size={14} className="text-muted-foreground" /> : <ChevronRight size={14} className="text-muted-foreground" />}
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          {label} ({count})
        </h2>
      </button>
      {open && (
        count === 0 ? (
          <p className="text-sm text-muted-foreground ml-5">{emptyMessage}</p>
        ) : (
          <div className="space-y-2 ml-5">
            {jobs.map((j) => (
              <JobCard key={j.episode_id} job={j} onRetry={onRetry} showStatus={showStatus} />
            ))}
          </div>
        )
      )}
    </section>
  );
}

interface KanbanColumnProps {
  columnKey: string;
  label: string;
  jobs: Job[];
  onRetry: (taskId: string) => void;
}

/** Single Kanban column — per issue #44 */
function KanbanColumn({ columnKey, label, jobs, onRetry }: KanbanColumnProps) {
  const isEmpty = jobs.length === 0;
  const bgColor = COLUMN_COLORS[columnKey] ?? "bg-muted/30";
  const borderColor = COLUMN_BORDER_COLORS[columnKey] ?? "border-border";

  return (
    <div
      className={`flex flex-col min-w-[220px] max-w-[280px] w-full rounded-lg border ${borderColor} ${
        isEmpty ? "opacity-50" : ""
      } snap-start`}
    >
      {/* Column header */}
      <div className={`flex items-center justify-between px-3 py-2 rounded-t-lg ${bgColor}`}>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          {label}
        </h3>
        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 min-w-[20px] justify-center">
          {jobs.length}
        </Badge>
      </div>

      {/* Cards */}
      <div className="flex-1 p-2 space-y-2 overflow-y-auto max-h-[60vh]">
        {isEmpty ? (
          <p className="text-xs text-muted-foreground text-center py-4">No episodes</p>
        ) : (
          jobs.map((job) => (
            <BoardCard key={job.episode_id} job={job} onRetry={onRetry} />
          ))
        )}
      </div>
    </div>
  );
}

interface KanbanBoardProps {
  columns: { key: string; label: string; jobs: Job[] }[];
  onRetry: (taskId: string) => void;
}

/** Kanban board layout with horizontal scroll — per issue #44 */
function KanbanBoard({ columns, onRetry }: KanbanBoardProps) {
  return (
    <div className="overflow-x-auto -mx-4 px-4 pb-2 snap-x snap-mandatory lg:snap-none">
      <div className="flex gap-3 min-w-min">
        {columns.map((col) => (
          <KanbanColumn
            key={col.key}
            columnKey={col.key}
            label={col.label}
            jobs={col.jobs}
            onRetry={onRetry}
          />
        ))}
      </div>
    </div>
  );
}

function getAllJobs(queue: QueueState): Job[] {
  return [...queue.active_jobs, ...queue.pending_jobs, ...queue.failed_jobs];
}

function groupByPodcast(queue: QueueState): { label: string; jobs: Job[] }[] {
  const all = getAllJobs(queue);
  const groups = new Map<string, Job[]>();
  for (const job of all) {
    const key = job.feed_title ?? "Unknown Podcast";
    const list = groups.get(key) ?? [];
    list.push(job);
    groups.set(key, list);
  }
  return Array.from(groups.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([label, jobs]) => ({ label, jobs }));
}

/** Group jobs by processing stage — returns all stages (including empty) for board view */
function groupByStage(queue: QueueState, includeEmpty: boolean): { key: string; label: string; jobs: Job[] }[] {
  const all = getAllJobs(queue);
  const groups = new Map<string, Job[]>();
  for (const stage of STAGE_ORDER) {
    groups.set(stage, []);
  }
  for (const job of all) {
    const stage = STAGE_ORDER.includes(job.status) ? job.status : "pending";
    groups.get(stage)!.push(job);
  }
  return STAGE_ORDER
    .filter((stage) => includeEmpty || groups.get(stage)!.length > 0)
    .map((stage) => ({ key: stage, label: STAGE_LABELS[stage], jobs: groups.get(stage)! }));
}

/** Group jobs by status (active/pending/done/failed) — returns all statuses for board view */
function groupByStatus(queue: QueueState): { key: string; label: string; jobs: Job[] }[] {
  const statusMap: Record<string, Job[]> = {
    pending: [...queue.pending_jobs],
    active: [...queue.active_jobs],
    done: [],
    failed: [...queue.failed_jobs],
  };

  // Active jobs that are "done" should be in the done column; active_jobs from the API
  // represent currently processing jobs, so they stay in "active".
  // Done jobs are not returned by the queue API (they've completed), so the column
  // will typically be empty but we show it to convey the pipeline shape.

  return STATUS_ORDER.map((status) => ({
    key: status,
    label: STATUS_LABELS[status],
    jobs: statusMap[status] ?? [],
  }));
}

/**
 * Queue dashboard component — PRD-02 §5.6
 * Polls /api/queue every 5s and /api/health for warm-up state.
 * Supports grouping by status, podcast, or processing stage.
 * Supports list and Kanban board view styles — per issue #44.
 */
export default function QueueStatus() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [workerStatus, setWorkerStatus] = useState<string>("OK");
  const [groupMode, setGroupMode] = useState<GroupMode>(getStoredGroupMode);
  const [viewStyle, setViewStyle] = useState<ViewStyle>(getStoredViewStyle);

  const handleGroupChange = useCallback((value: string) => {
    const mode = value as GroupMode;
    setGroupMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, []);

  const handleViewStyleToggle = useCallback(() => {
    setViewStyle((prev) => {
      const next = prev === "list" ? "board" : "list";
      localStorage.setItem(VIEW_STYLE_KEY, next);
      return next;
    });
  }, []);

  /** Board view is available for status and stage groupings, not podcast */
  const boardAvailable = groupMode !== "podcast";

  /** Effective view style — force list for podcast grouping */
  const effectiveView = boardAvailable ? viewStyle : "list";

  useEffect(() => {
    async function fetchAll() {
      try {
        const [qRes, hRes] = await Promise.all([
          fetch("/api/queue"),
          fetch("/api/pipeline/health"),
        ]);
        if (qRes.ok) setQueue(await qRes.json());
        if (hRes.ok) {
          const h = await hRes.json();
          setWorkerStatus(h.status);
        }
      } catch (_) {}
    }
    fetchAll();
    const id = setInterval(fetchAll, 5000);
    return () => clearInterval(id);
  }, []);

  async function handleRetry(taskId: string) {
    await fetch(`/api/pipeline/queue/${taskId}/retry`, { method: "POST" });
  }

  const podcastGroups = useMemo(() => queue ? groupByPodcast(queue) : [], [queue]);
  const stageGroupsForList = useMemo(() => queue ? groupByStage(queue, false) : [], [queue]);
  const stageColumnsForBoard = useMemo(() => queue ? groupByStage(queue, true) : [], [queue]);
  const statusColumnsForBoard = useMemo(() => queue ? groupByStatus(queue) : [], [queue]);

  if (!queue) {
    return (
      <div className="space-y-4">
        {[1, 2, 3].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-14 w-full" />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Toolbar: grouping selector + view style toggle */}
      <div className="flex items-center justify-end gap-2">
        {/* View style toggle — per issue #44 */}
        {boardAvailable && (
          <button
            onClick={handleViewStyleToggle}
            title={effectiveView === "list" ? "Switch to board view" : "Switch to list view"}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border bg-background hover:bg-accent transition-colors"
          >
            {effectiveView === "list" ? <Kanban size={14} /> : <LayoutList size={14} />}
            {effectiveView === "list" ? "Board" : "List"}
          </button>
        )}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-md border bg-background hover:bg-accent transition-colors">
              <LayoutList size={14} />
              {GROUP_MODE_LABELS[groupMode]}
              <ChevronDown size={12} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuRadioGroup value={groupMode} onValueChange={handleGroupChange}>
              <DropdownMenuRadioItem value="status">By Status</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="podcast">By Podcast</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="stage">By Processing Stage</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {workerStatus === "WARMING_UP" && (
        <Card className="border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-950">
          <CardContent className="p-4 flex items-start gap-3">
            <RefreshCw size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 animate-spin" />
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Worker is initializing — downloading models (~3 GB). Jobs will begin processing once
              complete.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Board view: Status grouping — per issue #44 */}
      {groupMode === "status" && effectiveView === "board" && (
        <KanbanBoard columns={statusColumnsForBoard} onRetry={handleRetry} />
      )}

      {/* Board view: Stage grouping — per issue #44 */}
      {groupMode === "stage" && effectiveView === "board" && (
        <KanbanBoard columns={stageColumnsForBoard} onRetry={handleRetry} />
      )}

      {/* List view: Group by Status (default — matches original behavior) */}
      {groupMode === "status" && effectiveView === "list" && (
        <>
          <CollapsibleGroup
            label="Active"
            count={queue.active_count}
            emptyMessage="No active jobs"
            jobs={queue.active_jobs}
            onRetry={handleRetry}
          />
          <CollapsibleGroup
            label="Pending"
            count={queue.pending_count}
            emptyMessage="Queue is empty"
            jobs={queue.pending_jobs}
            onRetry={handleRetry}
          />
          <CollapsibleGroup
            label="Failed"
            count={queue.failed_count}
            emptyMessage="No failed jobs"
            jobs={queue.failed_jobs}
            onRetry={handleRetry}
          />
        </>
      )}

      {/* List view: Group by Podcast (always list — per issue #44) */}
      {groupMode === "podcast" && (
        podcastGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs in queue</p>
        ) : (
          podcastGroups.map((group) => (
            <CollapsibleGroup
              key={group.label}
              label={group.label}
              count={group.jobs.length}
              emptyMessage="No jobs"
              jobs={group.jobs}
              onRetry={handleRetry}
              showStatus
            />
          ))
        )
      )}

      {/* List view: Group by Processing Stage */}
      {groupMode === "stage" && effectiveView === "list" && (
        stageGroupsForList.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs in queue</p>
        ) : (
          stageGroupsForList.map((group) => (
            <CollapsibleGroup
              key={group.label}
              label={group.label}
              count={group.jobs.length}
              emptyMessage="No jobs"
              jobs={group.jobs}
              onRetry={handleRetry}
            />
          ))
        )
      )}
    </div>
  );
}
