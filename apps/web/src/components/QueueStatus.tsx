"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, RefreshCw, ChevronDown } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

interface Job {
  episode_id: string;
  title: string | null;
  status: string;
  celery_task_id: string | null;
  error_message: string | null;
  error_class: string | null;
  retry_count: number;
  retry_max: number;
}

interface QueueState {
  active_count: number;
  pending_count: number;
  failed_count: number;
  active_jobs: Job[];
  pending_jobs: Job[];
  failed_jobs: Job[];
}

const ERROR_CLASS_LABELS: Record<string, string> = {
  TRANSIENT_NETWORK: "Network error",
  HTTP_ACCESS: "Access error",
  DISK_FULL: "Disk full — free space and retry",
  OOM: "Out of memory — check hardware requirements",
  SYSTEM_ERROR: "Unexpected error",
};

const NON_RETRYABLE = ["DISK_FULL", "OOM"];

function JobCard({ job, onRetry }: { job: Job; onRetry: (taskId: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const canRetry = job.celery_task_id && !NON_RETRYABLE.includes(job.error_class ?? "");

  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-start justify-between gap-2">
          <span className="text-sm font-medium">{job.title ?? job.episode_id}</span>
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

/**
 * Queue dashboard component — PRD-02 §5.6
 * Polls /api/queue every 5s and /api/health for warm-up state.
 */
export default function QueueStatus() {
  const [queue, setQueue] = useState<QueueState | null>(null);
  const [workerStatus, setWorkerStatus] = useState<string>("OK");

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

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Active ({queue.active_count})
        </h2>
        {queue.active_jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active jobs</p>
        ) : (
          <div className="space-y-2">
            {queue.active_jobs.map((j) => (
              <JobCard key={j.episode_id} job={j} onRetry={handleRetry} />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Pending ({queue.pending_count})
        </h2>
        {queue.pending_jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">Queue is empty</p>
        ) : (
          <div className="space-y-2">
            {queue.pending_jobs.map((j) => (
              <Card key={j.episode_id}>
                <CardContent className="p-3">
                  <span className="text-sm">{j.title ?? j.episode_id}</span>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
          Failed ({queue.failed_count})
        </h2>
        {queue.failed_jobs.length === 0 ? (
          <p className="text-sm text-muted-foreground">No failed jobs</p>
        ) : (
          <div className="space-y-2">
            {queue.failed_jobs.map((j) => (
              <JobCard key={j.episode_id} job={j} onRetry={handleRetry} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
