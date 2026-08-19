/**
 * @jest-environment node
 *
 * #955: the retry rules exist in two runtimes and nothing kept them in step.
 * The server's manual-retry guard (app/api/queue.py::NON_RETRYABLE) and the
 * UI's button suppression (queueStatus.ts::NON_RETRYABLE) had already drifted
 * -- SYSTEM_ERROR blocks automatic retry but neither of these -- which is how
 * a no-speech episode ended up offering a Retry button that could only ever
 * reproduce the same outcome.
 *
 * Same reasoning as normalizeName.ts <-> inference_helpers.py in CLAUDE.md:
 * duplicated rules across runtimes need a test that enumerates both.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { NON_RETRYABLE, TERMINAL_STATUSES } from "@/lib/queueStatus";

const PIPELINE = join(__dirname, "../../../pipeline");

function pythonSet(file: string, name: string): Set<string> {
  const src = readFileSync(join(PIPELINE, file), "utf8");
  const m = src.match(new RegExp(`${name}\\s*=\\s*(?:frozenset\\()?\\{([^}]*)\\}`));
  if (!m) throw new Error(`${name} not found in ${file}`);
  return new Set(
    [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1])
  );
}

describe("retry-rule parity between the pipeline and the web app (#955)", () => {
  it("NON_RETRYABLE matches app/api/queue.py", () => {
    const server = pythonSet("app/api/queue.py", "NON_RETRYABLE");
    expect([...NON_RETRYABLE].sort()).toEqual([...server].sort());
  });

  it("TERMINAL_STATUSES matches app/tasks/helpers.py", () => {
    const server = pythonSet("app/tasks/helpers.py", "TERMINAL_STATUSES");
    expect([...TERMINAL_STATUSES].sort()).toEqual([...server].sort());
  });

  it("both include the no-speech case", () => {
    expect(NON_RETRYABLE.has("NO_SPEECH")).toBe(true);
    expect(TERMINAL_STATUSES.has("no_speech")).toBe(true);
  });
});
