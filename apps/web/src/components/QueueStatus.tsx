"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import { RefreshCw, ChevronDown, ChevronRight, FlaskConical, LayoutList } from "lucide-react";
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
  archiving: "default",
  done: "outline",
  failed: "destructive",
};

const STAGE_ORDER = ["pending", "downloading", "transcribing", "diarizing", "archiving", "failed"];

const STAGE_LABELS: Record<string, string> = {
  pending: "Pending",
  downloading: "Downloading",
  transcribing: "Transcribing",
  diarizing: "Diarizing",
  archiving: "Archiving",
  failed: "Failed",
};

const STORAGE_KEY = "podlog-queue-grouping";

function getStoredGroupMode(): GroupMode {
  if (typeof window === "undefined") return "status";
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "status" || stored === "podcast" || stored === "stage") return stored;
  return "status";
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

function groupByStage(queue: QueueState): { label: string; jobs: Job[] }[] {
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
    .filter((stage) => groups.get(stage)!.length > 0)
    .map((stage) => ({ label: STAGE_LABELS[stage], jobs: groups.get(stage)! }));
}

/**
 * Queue dashboard component — PRD-02 §5.6
 * Polls /api/queue every 5s and /api/health for warm-up state.
 * Supports grouping by status, podcast, or processing stage.
 */
export default function QueueStatus() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [workerStatus, setWorkerStatus] = useState<string>("OK");
  const [groupMode, setGroupMode] = useState<GroupMode>(getStoredGroupMode);

  const handleGroupChange = useCallback((value: string) => {
    const mode = value as GroupMode;
    setGroupMode(mode);
    localStorage.setItem(STORAGE_KEY, mode);
  }, []);

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
  const stageGroups = useMemo(() => queue ? groupByStage(queue) : [], [queue]);

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
      {/* Grouping selector */}
      <div className="flex items-center justify-end">
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

      {/* Group by Status (default — matches original behavior) */}
      {groupMode === "status" && (
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

      {/* Group by Podcast */}
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

      {/* Group by Processing Stage */}
      {groupMode === "stage" && (
        stageGroups.length === 0 ? (
          <p className="text-sm text-muted-foreground">No jobs in queue</p>
        ) : (
          stageGroups.map((group) => (
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
