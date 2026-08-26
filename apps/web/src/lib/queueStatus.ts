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

/**
 * Every status the dashboard can display, in pipeline order.
 *
 * `inBar: false` means the status still needs a colour and a label -- it is
 * rendered as a badge on a row -- but gets no segment in the stage bar.
 *
 * #968: chunking and embedding were absent entirely. Episodes in those two
 * stages were uncounted in the bar, unfilterable, and rendered grey because
 * StatusBadge falls back to #888 when it finds no entry -- so an episode
 * dropped out of the bar after Diarizing and reappeared at Inferring. Any
 * status a pipeline task can write must have an entry here; the parity test
 * in tests/unit/queue-stage-parity.test.ts enforces it against the Python
 * task modules.
 */
export const STAGES = [
  { key: "pending", label: "Pending", color: "#eab308", bg: "rgba(234,179,8,0.15)" },
  { key: "downloading", label: "Downloading", color: "#06b6d4", bg: "rgba(6,182,212,0.15)" },
  { key: "transcribing", label: "Transcribing", color: "#2563eb", bg: "rgba(37,99,235,0.15)" },
  { key: "diarizing", label: "Diarizing", color: "#7c3aed", bg: "rgba(124,58,237,0.15)" },
  { key: "chunking", label: "Chunking", color: "#0891b2", bg: "rgba(8,145,178,0.15)" },
  { key: "embedding", label: "Embedding", color: "#4f46e5", bg: "rgba(79,70,229,0.15)" },
  { key: "inferring", label: "Inferring", color: "#f97316", bg: "rgba(249,115,22,0.15)" },
  { key: "archiving", label: "Archiving", color: "#14b8a6", bg: "rgba(20,184,166,0.15)" },
  { key: "done", label: "Done", color: "#16a34a", bg: "rgba(22,163,74,0.15)" },
  // Terminal, not a failure, and deliberately not a bar segment: no_speech
  // rows ride in the done bucket (#968) and are told apart by this badge.
  { key: "no_speech", label: "No speech", color: "#d97706", bg: "rgba(217,119,6,0.15)", inBar: false },
  { key: "failed", label: "Failed", color: "#dc2626", bg: "rgba(220,38,38,0.15)" },
  { key: "stuck", label: "Stuck", color: "#a855f7", bg: "rgba(168,85,247,0.15)" },
] as const;

/** The subset of STAGES that gets a clickable segment in the stage bar. */
export const BAR_STAGES = STAGES.filter(
  (s) => !("inBar" in s && s.inBar === false)
);

export const ACTIVE_STATUSES = new Set<string>([
  "downloading", "transcribing", "diarizing", "chunking", "embedding",
  "inferring", "archiving",
]);

/**
 * The in-flight stages, in pipeline order, for the step chain on episode
 * cards.
 *
 * Derived rather than listed (#968). EpisodeCard used to keep its own
 * hardcoded copy — `["downloading", "transcribing", "diarizing",
 * "archiving"]` — which omitted chunking, embedding *and* inferring. Because
 * ProcessingProgress bails on `indexOf(status) === -1`, an episode in any of
 * those three rendered no progress chain at all, and `isProcessing` was false
 * so the card did not read as in-flight either. Deriving it from STAGES means
 * there is no third copy left to drift.
 */
export const PROCESSING_STEPS: string[] = STAGES.filter((s) =>
  ACTIVE_STATUSES.has(s.key)
).map((s) => s.key);

/** Human label for a status, falling back to the raw key. */
export function stageLabel(status: string): string {
  return STAGES.find((s) => s.key === status)?.label ?? status;
}

/**
 * Statuses an episode can rest in permanently. Mirrors
 * apps/pipeline/app/tasks/helpers.py::TERMINAL_STATUSES -- a parity test
 * asserts the two match, because anything missing here is treated as
 * mid-pipeline and shows as an active job forever (#955).
 */
export const TERMINAL_STATUSES = new Set(["done", "failed", "no_speech"]);

/**
 * Error classes where the Retry button is hidden: retrying cannot change the
 * outcome. Mirrors apps/pipeline/app/api/queue.py::NON_RETRYABLE, which also
 * rejects the request server-side.
 */
export const NON_RETRYABLE = new Set([
  "DISK_FULL",
  "OOM",
  // #650: clicking Retry on a manual upload whose file is gone would
  // just re-issue the same terminal failure. Suppress the button.
  "MANUAL_UPLOAD_FILE_MISSING",
  // #955: the audio contains no speech. Re-running the pipeline re-downloads
  // and re-transcribes to reach the identical result.
  "NO_SPEECH",
]);

export const ERROR_LABELS: Record<string, string> = {
  TRANSIENT_NETWORK: "Network error",
  HTTP_ACCESS: "Access error",
  DISK_FULL: "Disk full — free space and retry",
  OOM: "Out of memory — check hardware requirements",
  SYSTEM_ERROR: "Unexpected error",
  MANUAL_UPLOAD_FILE_MISSING: "Manual upload file missing — re-upload and retry",
  NO_SPEECH: "No speech detected — nothing to index",
};

export function sortByUpdated(jobs: Job[]): Job[] {
  return [...jobs].sort(
    (a, b) => new Date(b.updated_at ?? 0).getTime() - new Date(a.updated_at ?? 0).getTime()
  );
}

export function stageCounts(queue: QueueState): Record<string, number> {
  const counts: Record<string, number> = {};
  // Seed every known status, including ones with no bar segment, so callers
  // can read a count for any of them without an undefined check.
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
  // #968: no_speech rides in the done bucket and is counted under Done, so
  // filtering by Done has to include it too -- otherwise the segment shows a
  // count the filter cannot reproduce.
  const matchesStage = (j: Job) =>
    !stageFilter ||
    j.status === stageFilter ||
    (stageFilter === "done" && j.status === "no_speech");

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
