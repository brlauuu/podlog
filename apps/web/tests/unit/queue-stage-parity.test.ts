/**
 * @jest-environment node
 *
 * #968: the set of statuses a pipeline task can write lives in Python, and
 * the set the dashboard knows how to display lives in TypeScript. Nothing
 * kept them in step, so `chunking` and `embedding` were written by the
 * pipeline and had no STAGES entry -- uncounted in the stage bar,
 * unfilterable, and rendered grey by StatusBadge's #888 fallback. An episode
 * dropped out of the bar after Diarizing and reappeared at Inferring.
 *
 * Same reasoning as retry-sets-parity.test.ts and the normalizeName.ts <->
 * inference_helpers.py convention in CLAUDE.md: a rule duplicated across two
 * runtimes needs a test that enumerates both sides.
 */
import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import {
  STAGES,
  BAR_STAGES,
  ACTIVE_STATUSES,
  TERMINAL_STATUSES,
  PROCESSING_STEPS,
} from "@/lib/queueStatus";

const TASKS_DIR = join(__dirname, "../../../pipeline/app/tasks");
// TASK_TO_STATUS moved from api/queue.py to services/queue_snapshot.py (#1034)
// so the Telegram bot can share the query without importing the API layer.
const QUEUE_API = join(__dirname, "../../../pipeline/app/services/queue_snapshot.py");

/** Every literal assigned to `status=` / `status = ` in the task modules. */
function statusesWrittenByTasks(): Set<string> {
  const found = new Set<string>();
  for (const file of readdirSync(TASKS_DIR).filter((f) => f.endsWith(".py"))) {
    const src = readFileSync(join(TASKS_DIR, file), "utf8");
    for (const m of src.matchAll(/status\s*=\s*"([a-z_]+)"/g)) {
      found.add(m[1]);
    }
  }
  return found;
}

/** The display statuses TASK_TO_STATUS maps job_queue tasks onto. */
function displayStatusesFromQueueApi(): Set<string> {
  const src = readFileSync(QUEUE_API, "utf8");
  const block = src.match(/TASK_TO_STATUS: dict\[str, str\] = \{([^}]*)\}/);
  if (!block) throw new Error("TASK_TO_STATUS not found in services/queue_snapshot.py");
  return new Set(
    [...block[1].matchAll(/"[a-z_]+":\s*"([a-z_]+)"/g)].map((m) => m[1])
  );
}

const stageKeys = new Set(STAGES.map((s) => s.key as string));

describe("queue stage parity between the pipeline and the dashboard (#968)", () => {
  it("finds statuses to check (guards a vacuous pass)", () => {
    expect(statusesWrittenByTasks().size).toBeGreaterThan(5);
    expect(displayStatusesFromQueueApi().size).toBeGreaterThan(5);
  });

  it("every status a pipeline task writes has a STAGES entry", () => {
    const missing = [...statusesWrittenByTasks()].filter((s) => !stageKeys.has(s));
    expect(missing).toEqual([]);
  });

  it("every display status in TASK_TO_STATUS has a STAGES entry", () => {
    const missing = [...displayStatusesFromQueueApi()].filter((s) => !stageKeys.has(s));
    expect(missing).toEqual([]);
  });

  it("every in-flight display status is in ACTIVE_STATUSES", () => {
    // Anything TASK_TO_STATUS maps to is by definition a job in progress, so
    // it should pulse. `chunking` was absent, so it rendered static while
    // every other in-flight stage animated.
    const missing = [...displayStatusesFromQueueApi()].filter(
      (s) => !ACTIVE_STATUSES.has(s)
    );
    expect(missing).toEqual([]);
  });

  it("no status is both in-flight and terminal", () => {
    const overlap = [...ACTIVE_STATUSES].filter((s) => TERMINAL_STATUSES.has(s));
    expect(overlap).toEqual([]);
  });

  it("chunking and embedding are displayable and filterable", () => {
    // The two the dashboard was blind to. They are real stages, so unlike
    // no_speech they belong in the bar.
    for (const key of ["chunking", "embedding"]) {
      expect(stageKeys.has(key)).toBe(true);
      expect(BAR_STAGES.some((s) => s.key === key)).toBe(true);
    }
  });

  it("the episode-card step chain covers every in-flight stage", () => {
    // EpisodeCard kept its own hardcoded copy omitting chunking, embedding
    // and inferring. ProcessingProgress bails on indexOf(status) === -1, so
    // an episode in any of those rendered no progress chain at all, and
    // isProcessing was false so the card did not read as in-flight either.
    expect([...PROCESSING_STEPS].sort()).toEqual([...ACTIVE_STATUSES].sort());
  });

  it("the step chain is in pipeline order, not alphabetical", () => {
    // Order is what makes the chain meaningful -- it drives which steps show
    // as done vs pending relative to the current one.
    const order = STAGES.map((s) => s.key as string);
    const positions = PROCESSING_STEPS.map((s) => order.indexOf(s));
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
    expect(PROCESSING_STEPS[0]).toBe("downloading");
    expect(PROCESSING_STEPS[PROCESSING_STEPS.length - 1]).toBe("archiving");
  });

  it("every step in the chain has a human label", () => {
    for (const step of PROCESSING_STEPS) {
      const stage = STAGES.find((s) => s.key === step);
      expect(stage?.label).toBeTruthy();
      expect(stage?.label).not.toMatch(/_/);
    }
  });

  it("no_speech is catalogued but kept out of the stage bar", () => {
    // It rides in the done bucket rather than getting its own segment, but it
    // still needs a colour and label so StatusBadge does not grey it out.
    expect(stageKeys.has("no_speech")).toBe(true);
    expect(BAR_STAGES.some((s) => s.key === "no_speech")).toBe(false);
    expect(STAGES.find((s) => s.key === "no_speech")?.label).toBe("No speech");
  });
});
