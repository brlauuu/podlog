/**
 * @jest-environment node
 */

import { computeQueueViewModel, sortByUpdated, stageCounts, type QueueState, type Job } from "@/lib/queueStatus";

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    episode_id: "ep-1",
    title: "Alpha Episode",
    status: "pending",
    error_message: null,
    error_class: null,
    retry_count: 0,
    retry_max: 3,
    feed_mode: "full",
    feed_title: "Podcast A",
    updated_at: "2026-04-09T10:00:00.000Z",
    ...overrides,
  };
}

function makeQueue(overrides: Partial<QueueState> = {}): QueueState {
  return {
    active_count: 1,
    pending_count: 1,
    failed_count: 1,
    done_count: 1,
    stuck_count: 1,
    active_jobs: [makeJob({ episode_id: "ep-active", status: "transcribing", updated_at: "2026-04-09T10:05:00.000Z" })],
    pending_jobs: [makeJob({ episode_id: "ep-pending", status: "pending", updated_at: "2026-04-09T10:04:00.000Z" })],
    failed_jobs: [makeJob({ episode_id: "ep-failed", status: "failed", updated_at: "2026-04-09T10:03:00.000Z" })],
    done_jobs: [makeJob({ episode_id: "ep-done", status: "done", updated_at: "2026-04-09T10:02:00.000Z" })],
    stuck_jobs: [makeJob({ episode_id: "ep-stuck", status: "stuck", updated_at: "2026-04-09T10:06:00.000Z" })],
    ...overrides,
  };
}

describe("queueStatus logic", () => {
  test("sortByUpdated returns newest first", () => {
    const jobs = [
      makeJob({ episode_id: "a", updated_at: "2026-04-09T10:00:00.000Z" }),
      makeJob({ episode_id: "b", updated_at: "2026-04-09T10:10:00.000Z" }),
      makeJob({ episode_id: "c", updated_at: "2026-04-09T10:05:00.000Z" }),
    ];
    const sorted = sortByUpdated(jobs);
    expect(sorted.map((j) => j.episode_id)).toEqual(["b", "c", "a"]);
  });

  test("stageCounts aggregates active/pending/failed/stuck jobs and done_count", () => {
    const counts = stageCounts(makeQueue());
    expect(counts.stuck).toBe(1);
    expect(counts.failed).toBe(1);
    expect(counts.transcribing).toBe(1);
    expect(counts.pending).toBe(1);
    expect(counts.done).toBe(1);
  });

  test("computeQueueViewModel filters by stage and search and auto-shows done on done filter", () => {
    const vm = computeQueueViewModel({
      queue: makeQueue(),
      search: "podcast a",
      stageFilter: "done",
      showDone: false,
    });

    expect(vm.filtered).toHaveLength(0);
    expect(vm.filteredDone).toHaveLength(1);
    expect(vm.effectiveShowDone).toBe(true);
  });

  test("computeQueueViewModel orders allJobs as stuck, failed, active, pending", () => {
    const vm = computeQueueViewModel({
      queue: makeQueue(),
      search: "",
      stageFilter: null,
      showDone: false,
    });

    expect(vm.allJobs.map((j) => j.episode_id)).toEqual([
      "ep-stuck",
      "ep-failed",
      "ep-active",
      "ep-pending",
    ]);
  });
});

describe("no_speech folded into the done bucket (#968)", () => {
  const base = {
    active_count: 0, pending_count: 0, failed_count: 0, stuck_count: 0,
    active_jobs: [], pending_jobs: [], failed_jobs: [], stuck_jobs: [],
  };
  const job = (id: string, status: string) => ({
    episode_id: id, title: id, status,
    error_message: null, error_class: null,
    retry_count: 0, retry_max: 3,
    feed_mode: null, feed_title: null, updated_at: "2026-08-26T00:00:00Z",
  });

  const queue = {
    ...base,
    done_count: 2,
    done_jobs: [job("ep-ok", "done"), job("ep-ns", "no_speech")],
  };

  it("lists no_speech rows alongside done ones", () => {
    const vm = computeQueueViewModel({
      queue, search: "", stageFilter: null, showDone: true,
    });
    expect(vm.filteredDone.map((j) => j.episode_id)).toEqual(["ep-ok", "ep-ns"]);
  });

  it("includes no_speech when filtering by Done", () => {
    // The Done segment counts them, so the Done filter has to return them
    // too -- otherwise the count is one the filter cannot reproduce.
    const vm = computeQueueViewModel({
      queue, search: "", stageFilter: "done", showDone: false,
    });
    expect(vm.filteredDone.map((j) => j.episode_id)).toEqual(["ep-ok", "ep-ns"]);
    expect(vm.effectiveShowDone).toBe(true);
  });

  it("does not report an empty queue when only no_speech episodes exist", () => {
    const vm = computeQueueViewModel({
      queue: { ...base, done_count: 1, done_jobs: [job("ep-ns", "no_speech")] },
      search: "", stageFilter: null, showDone: true,
    });
    expect(vm.isEmpty).toBe(false);
  });

  it("seeds a count for statuses that have no bar segment", () => {
    const vm = computeQueueViewModel({
      queue, search: "", stageFilter: null, showDone: true,
    });
    expect(vm.counts.no_speech).toBe(0);
    expect(vm.counts.chunking).toBe(0);
    expect(vm.counts.embedding).toBe(0);
  });

  it("counts chunking and embedding episodes in the bar", () => {
    const vm = computeQueueViewModel({
      queue: {
        ...base,
        done_count: 0,
        done_jobs: [],
        active_jobs: [job("ep-c", "chunking"), job("ep-e", "embedding")],
        active_count: 2,
      },
      search: "", stageFilter: null, showDone: false,
    });
    expect(vm.counts.chunking).toBe(1);
    expect(vm.counts.embedding).toBe(1);
  });
});
