/**
 * Tests for GET /api/queue — the queue dashboard's data source.
 *
 * The route runs 6 parallel SQL queries. We mock pool.query with a
 * dispatcher that matches on query text so each call returns the
 * right shape.
 *
 * @jest-environment node
 */
const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({ __esModule: true, default: { query: mockQuery } }));

type RouteModule = typeof import("@/app/api/queue/route");
let GET: RouteModule["GET"];

beforeAll(async () => {
  const mod: RouteModule = await import("@/app/api/queue/route");
  GET = mod.GET;
});

beforeEach(() => {
  mockQuery.mockReset();
});

type QueueRow = Record<string, unknown>;

function dispatch(rows: {
  active?: QueueRow[];
  pending?: QueueRow[];
  failed?: QueueRow[];
  done?: QueueRow[];
  doneCount?: string;
  stuck?: QueueRow[];
}) {
  mockQuery.mockImplementation((sql: string) => {
    if (/jq\.status\s*=\s*'picked'/.test(sql)) {
      return Promise.resolve({ rows: rows.active ?? [] });
    }
    if (/jq\.status\s*=\s*'pending'/.test(sql)) {
      return Promise.resolve({ rows: rows.pending ?? [] });
    }
    if (/e\.status\s*=\s*'failed'/.test(sql)) {
      return Promise.resolve({ rows: rows.failed ?? [] });
    }
    if (/COUNT\(\*\) AS count/.test(sql)) {
      return Promise.resolve({ rows: [{ count: rows.doneCount ?? "0" }] });
    }
    if (/e\.status\s*=\s*'done'/.test(sql)) {
      return Promise.resolve({ rows: rows.done ?? [] });
    }
    if (/NOT EXISTS/.test(sql)) {
      return Promise.resolve({ rows: rows.stuck ?? [] });
    }
    return Promise.resolve({ rows: [] });
  });
}

describe("GET /api/queue", () => {
  it("returns empty buckets and zero counts when DB is empty", async () => {
    dispatch({});

    const resp = await GET();

    expect(resp.status).toBe(200);
    const data = await resp.json();
    expect(data).toEqual({
      active_count: 0,
      pending_count: 0,
      failed_count: 0,
      done_count: 0,
      stuck_count: 0,
      active_jobs: [],
      pending_jobs: [],
      failed_jobs: [],
      done_jobs: [],
      stuck_jobs: [],
    });
    expect(mockQuery).toHaveBeenCalledTimes(6);
  });

  it("maps active job task to display status via TASK_TO_STATUS", async () => {
    dispatch({
      active: [
        { episode_id: "ep-1", title: "T1", active_task: "transcribe" },
        { episode_id: "ep-2", title: "T2", active_task: "diarize" },
        { episode_id: "ep-3", title: "T3", active_task: "download" },
        { episode_id: "ep-4", title: "T4", active_task: "embed" },
        { episode_id: "ep-5", title: "T5", active_task: "infer" },
        { episode_id: "ep-6", title: "T6", active_task: "archive" },
      ],
    });

    const resp = await GET();
    const data = await resp.json();

    expect(data.active_count).toBe(6);
    const statuses = data.active_jobs.map((j: { status: string }) => j.status);
    expect(statuses).toEqual([
      "transcribing",
      "diarizing",
      "downloading",
      "embedding",
      "inferring",
      "archiving",
    ]);
  });

  it("falls back to raw task name when task has no display mapping", async () => {
    dispatch({
      active: [{ episode_id: "ep-x", title: "X", active_task: "custom_task" }],
    });

    const resp = await GET();
    const data = await resp.json();

    expect(data.active_jobs[0].status).toBe("custom_task");
  });

  it("tags pending jobs with status='pending' and stuck jobs with status='stuck'", async () => {
    dispatch({
      pending: [{ episode_id: "ep-p", title: "P", pending_task: "transcribe" }],
      stuck: [{ episode_id: "ep-s", title: "S", status: "downloading:100" }],
    });

    const resp = await GET();
    const data = await resp.json();

    expect(data.pending_count).toBe(1);
    expect(data.pending_jobs[0]).toMatchObject({
      episode_id: "ep-p",
      status: "pending",
      pending_task: "transcribe",
    });
    expect(data.stuck_count).toBe(1);
    expect(data.stuck_jobs[0]).toMatchObject({
      episode_id: "ep-s",
      status: "stuck",
    });
  });

  it("returns failed jobs rows unchanged and done count as number", async () => {
    dispatch({
      failed: [
        {
          episode_id: "ep-f",
          title: "F",
          status: "failed",
          error_message: "HTTP 404",
        },
      ],
      done: [{ episode_id: "ep-d", title: "D", status: "done" }],
      doneCount: "1234",
    });

    const resp = await GET();
    const data = await resp.json();

    expect(data.failed_count).toBe(1);
    expect(data.failed_jobs[0].error_message).toBe("HTTP 404");
    expect(data.done_count).toBe(1234);
    expect(typeof data.done_count).toBe("number");
    expect(data.done_jobs[0].episode_id).toBe("ep-d");
  });

  it("returns 500 when any query throws", async () => {
    mockQuery.mockRejectedValue(new Error("connection refused"));
    const consoleErrorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    const resp = await GET();

    expect(resp.status).toBe(500);
    expect(await resp.json()).toEqual({ error: "Failed to fetch queue" });
    expect(consoleErrorSpy).toHaveBeenCalled();
    consoleErrorSpy.mockRestore();
  });
});
