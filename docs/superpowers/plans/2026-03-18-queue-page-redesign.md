# Queue Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 648-line QueueStatus component (kanban + 3 grouping modes) with a Summary + Table hybrid layout showing a stage progress bar, searchable episode table, and expandable error details.

**Architecture:** Backend adds `inferring` to active query, `updated_at` to job serialization, and `done_jobs` (limit 50) to the queue response. Frontend is a full rewrite of `QueueStatus.tsx` with StageBar, EpisodeTable, StatusBadge, and expandable failed rows. No new dependencies.

**Tech Stack:** Python/FastAPI (pipeline API), TypeScript/Next.js 14 (web app), Tailwind CSS for styling.

**Spec:** `docs/superpowers/specs/2026-03-18-queue-page-redesign-design.md`

---

### Task 1: Update Pipeline Queue API

**Files:**
- Modify: `apps/pipeline/app/api/queue.py:27-65`
- Test: `apps/pipeline/tests/unit/test_queue_api.py` (create if not exists)

- [ ] **Step 1: Write failing test for `inferring` in active jobs**

```python
# apps/pipeline/tests/unit/test_queue_api.py
"""Tests for the queue API response structure."""
from unittest.mock import MagicMock, patch

import pytest
from app.api.queue import get_queue


def _make_episode(status, **kwargs):
    """Create a mock Episode with required fields."""
    ep = MagicMock()
    ep.id = kwargs.get("id", "ep-1")
    ep.title = kwargs.get("title", "Test Episode")
    ep.status = status
    ep.celery_task_id = kwargs.get("celery_task_id", "task-1")
    ep.error_message = kwargs.get("error_message", None)
    ep.error_class = kwargs.get("error_class", None)
    ep.retry_count = kwargs.get("retry_count", 0)
    ep.retry_max = kwargs.get("retry_max", 3)
    ep.updated_at = kwargs.get("updated_at", None)
    ep.feed = MagicMock()
    ep.feed.mode = kwargs.get("feed_mode", "live")
    ep.feed.title = kwargs.get("feed_title", "Test Feed")
    return ep


class TestGetQueue:
    def test_inferring_episodes_are_active(self):
        """Inferring episodes should appear in active_jobs, not be omitted."""
        inferring_ep = _make_episode("inferring", id="ep-inf")
        db = MagicMock()
        # Mock the query chain to return our episode for active, empty for others
        query = db.query.return_value
        filter_result = MagicMock()
        query.filter.return_value = filter_result
        filter_result.all.side_effect = [
            [inferring_ep],  # active_jobs query
            [],              # pending_jobs query
            [],              # failed_jobs query
            [],              # done_jobs query
        ]
        # We'll test the response after implementing — for now verify the status list
        # includes "inferring"
        from app.api.queue import ACTIVE_STATUSES
        assert "inferring" in ACTIVE_STATUSES
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_queue_api.py::TestGetQueue::test_inferring_episodes_are_active -v`
Expected: FAIL with `ImportError` — `ACTIVE_STATUSES` does not exist yet as a module-level export

- [ ] **Step 3: Add `inferring` to active statuses, `updated_at` to job dict, and `done_jobs` to response**

In `apps/pipeline/app/api/queue.py`, make these changes:

1. Extract active statuses to a module-level constant:
```python
ACTIVE_STATUSES = ["downloading", "transcribing", "diarizing", "inferring", "archiving"]
```

2. Move `_job_dict` from a nested function inside `get_queue()` to a **module-level function** so it can be imported in tests. Update it to include `updated_at`:
```python
def _job_dict(ep) -> dict:
    return {
        "episode_id": ep.id,
        "title": ep.title,
        "status": ep.status,
        "celery_task_id": ep.celery_task_id,
        "error_message": ep.error_message,
        "error_class": ep.error_class,
        "retry_count": ep.retry_count,
        "retry_max": ep.retry_max,
        "feed_mode": ep.feed.mode if ep.feed else None,
        "feed_title": ep.feed.title if ep.feed else None,
        "updated_at": ep.updated_at.isoformat() if ep.updated_at else None,
    }
```

3. Update `QueueStateResponse` to include done:
```python
class QueueStateResponse(BaseModel):
    active_count: int
    pending_count: int
    failed_count: int
    done_count: int
    active_jobs: list[dict]
    pending_jobs: list[dict]
    failed_jobs: list[dict]
    done_jobs: list[dict]
```

4. In `get_queue()`, use `ACTIVE_STATUSES` for the active query, and add done query with separate total count:
```python
from sqlalchemy import func

# Total count (unlimited) for display
done_count = db.query(func.count(Episode.id)).filter(
    Episode.status == "done"
).scalar() or 0

# Limited result set for the response
done = db.query(Episode).filter(
    Episode.status == "done"
).order_by(Episode.updated_at.desc()).limit(50).all()
```

Include both `done_count` (total count) and `done_jobs` (limited to 50) in the response.

- [ ] **Step 4: Write test for `updated_at` in job dict**

```python
    def test_job_dict_includes_updated_at(self):
        """updated_at should be serialized as ISO 8601 string."""
        from datetime import datetime
        from app.api.queue import _job_dict

        ep = _make_episode("downloading", updated_at=datetime(2026, 3, 18, 12, 0, 0))
        result = _job_dict(ep)
        assert result["updated_at"] == "2026-03-18T12:00:00"

    def test_job_dict_updated_at_none(self):
        """updated_at should be None when not set."""
        from app.api.queue import _job_dict

        ep = _make_episode("pending", updated_at=None)
        result = _job_dict(ep)
        assert result["updated_at"] is None
```

- [ ] **Step 5: Write test for done_jobs in response**

```python
    def test_done_jobs_included_in_response(self):
        """Done episodes should appear in the response with a count."""
        from app.api.queue import _job_dict
        # Verify the QueueStateResponse model includes done fields
        from app.api.queue import QueueStateResponse
        schema = QueueStateResponse.model_json_schema()
        assert "done_count" in schema["properties"]
        assert "done_jobs" in schema["properties"]
```

- [ ] **Step 6: Run all queue API tests**

Run: `cd apps/pipeline && python -m pytest tests/unit/test_queue_api.py -v`
Expected: All PASS

- [ ] **Step 7: Commit**

```bash
git add apps/pipeline/app/api/queue.py apps/pipeline/tests/unit/test_queue_api.py
git commit -m "feat(queue-api): add inferring status, updated_at, and done_jobs to queue response"
```

---

### Task 2: Rewrite QueueStatus Component

**Files:**
- Rewrite: `apps/web/src/components/QueueStatus.tsx`
- Reference: `docs/superpowers/specs/2026-03-18-queue-page-redesign-design.md`

This is the main task — replacing the entire 648-line component.

**Note:** The existing code uses `useEffect` + `setInterval` for polling (not React Query despite CLAUDE.md mentioning it). We keep the same pattern for consistency with the existing codebase.

- [ ] **Step 1: Write the new QueueStatus.tsx**

Replace the entire file with the new implementation. The component structure:

```typescript
"use client";

import { useState, useEffect, useRef } from "react";
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
    await fetch(`/api/pipeline/queue/${taskId}/retry`, { method: "POST" });
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
```

- [ ] **Step 2: Verify it builds**

Run: `cd apps/web && npx next build`
Expected: Build succeeds with no type errors

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/QueueStatus.tsx
git commit -m "feat(queue-ui): rewrite QueueStatus with Summary + Table hybrid layout"
```

---

### Task 3: Update PRD-02

**Files:**
- Modify: `prds/PRD-02-search-web-app.md` (queue dashboard section §5.6)

- [ ] **Step 1: Update PRD-02 §5.6 to reflect the redesign**

In `prds/PRD-02-search-web-app.md`, find section 5.6 (Queue Dashboard) and update to reflect:
- Summary + Table hybrid layout replaces kanban/grouping modes
- Worker warm-up banner removed (brief warm-up doesn't warrant UI)
- Retry countdown timer removed (retry count N/M shown instead)
- Stage progress bar added
- Search filtering added
- Done episodes collapsed by default

Bump the version number and add a changelog entry.

- [ ] **Step 2: Commit**

```bash
git add prds/PRD-02-search-web-app.md
git commit -m "docs: update PRD-02 §5.6 to reflect queue page redesign"
```

---

### Task 4: Manual Smoke Test

- [ ] **Step 1: Rebuild web image**

```bash
make build
```

- [ ] **Step 2: Restart services**

```bash
make up
```

- [ ] **Step 3: Verify queue page**

Open http://localhost:3000/queue and verify:
- Stage progress bar shows correct counts
- Episode table shows active/failed/pending episodes
- Failed episodes expand on click to show error details
- Retry button works on failed episodes (that aren't DISK_FULL/OOM)
- Search filters episodes by title and podcast name
- "Show N completed episodes" expands to show done episodes
- Dark mode works (toggle if available)
- Narrow the browser window below 640px and verify Podcast and Retries columns hide

- [ ] **Step 4: Commit any fixes from smoke testing**

If any issues were found during smoke testing, fix them and commit.
