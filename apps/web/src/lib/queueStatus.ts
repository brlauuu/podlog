export interface Job {
  episode_id: string;
  title: string | null;
  status: string;
  error_message: string | null;
  error_class: string | null;
  retry_count: number;
  retry_max: number;
  feed_mode: string | null;
  feed_title: string | null;
  updated_at: string | null;
}

export interface QueueState {
  active_count: number;
  pending_count: number;
  failed_count: number;
  done_count: number;
  stuck_count: number;
  active_jobs: Job[];
  pending_jobs: Job[];
  failed_jobs: Job[];
  done_jobs: Job[];
  stuck_jobs: Job[];
}

export const STAGES = [
  { key: "pending", label: "Pending", color: "#eab308", bg: "rgba(234,179,8,0.15)" },
  { key: "downloading", label: "Downloading", color: "#06b6d4", bg: "rgba(6,182,212,0.15)" },
  { key: "transcribing", label: "Transcribing", color: "#2563eb", bg: "rgba(37,99,235,0.15)" },
  { key: "diarizing", label: "Diarizing", color: "#7c3aed", bg: "rgba(124,58,237,0.15)" },
  { key: "inferring", label: "Inferring", color: "#f97316", bg: "rgba(249,115,22,0.15)" },
  { key: "archiving", label: "Archiving", color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
  { key: "done", label: "Done", color: "#16a34a", bg: "rgba(22,163,74,0.15)" },
  { key: "failed", label: "Failed", color: "#dc2626", bg: "rgba(220,38,38,0.15)" },
  { key: "stuck", label: "Stuck", color: "#a855f7", bg: "rgba(168,85,247,0.15)" },
] as const;

export const ACTIVE_STATUSES = new Set([
  "downloading", "transcribing", "diarizing", "embedding", "inferring", "archiving",
]);

export const NON_RETRYABLE = new Set([
  "DISK_FULL",
  "OOM",
  // #650: clicking Retry on a manual upload whose file is gone would
  // just re-issue the same terminal failure. Suppress the button.
  "MANUAL_UPLOAD_FILE_MISSING",
]);

export const ERROR_LABELS: Record<string, string> = {
  TRANSIENT_NETWORK: "Network error",
  HTTP_ACCESS: "Access error",
  DISK_FULL: "Disk full — free space and retry",
  OOM: "Out of memory — check hardware requirements",
  SYSTEM_ERROR: "Unexpected error",
  MANUAL_UPLOAD_FILE_MISSING: "Manual upload file missing — re-upload and retry",
};

export function sortByUpdated(jobs: Job[]): Job[] {
  return [...jobs].sort(
    (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  );
}

export function stageCounts(queue: QueueState): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of STAGES) counts[s.key] = 0;
  const allJobs = [
    ...queue.active_jobs, ...queue.pending_jobs,
    ...queue.failed_jobs, ...(queue.stuck_jobs ?? []),
  ];
  for (const j of allJobs) counts[j.status] = (counts[j.status] || 0) + 1;
  counts.done = queue.done_count;
  return counts;
}

interface ComputeQueueViewModelArgs {
  queue: QueueState;
  search: string;
  stageFilter: string | null;
  showDone: boolean;
}

interface QueueViewModel {
  counts: Record<string, number>;
  allJobs: Job[];
  filtered: Job[];
  filteredDone: Job[];
  effectiveShowDone: boolean;
  isEmpty: boolean;
}

export function computeQueueViewModel({
  queue,
  search,
  stageFilter,
  showDone,
}: ComputeQueueViewModelArgs): QueueViewModel {
  const counts = stageCounts(queue);
  const allJobs = [
    ...sortByUpdated(queue.stuck_jobs ?? []),
    ...sortByUpdated(queue.failed_jobs),
    ...sortByUpdated(queue.active_jobs),
    ...sortByUpdated(queue.pending_jobs),
  ];

  const q = search.toLowerCase();
  const matchesSearch = (j: Job) =>
    (j.title ?? "").toLowerCase().includes(q) ||
    (j.feed_title ?? "").toLowerCase().includes(q);
  const matchesStage = (j: Job) => !stageFilter || j.status === stageFilter;

  const filtered = allJobs.filter((j) => matchesSearch(j) && matchesStage(j));
  const filteredDone = queue.done_jobs.filter((j) => matchesSearch(j) && matchesStage(j));
  const effectiveShowDone = showDone || stageFilter === "done";
  const isEmpty = allJobs.length === 0 && queue.done_count === 0;

  return {
    counts,
    allJobs,
    filtered,
    filteredDone,
    effectiveShowDone,
    isEmpty,
  };
}
