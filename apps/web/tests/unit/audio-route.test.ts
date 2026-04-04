/**
 * Unit test for audio route path validation — PRD-02 §13
 *
 * Tests the path traversal prevention logic without a live filesystem.
 */
import path from "path";

const AUDIO_ARCHIVE_DIR = "/data/audio/archive";

function isPathSafe(filename: string): boolean {
  const safeName = path.basename(filename);
  const resolved = path.resolve(AUDIO_ARCHIVE_DIR, safeName);
  return resolved.startsWith(AUDIO_ARCHIVE_DIR + path.sep);
}

describe("audio route path validation", () => {
  test("valid filename passes", () => {
    expect(isPathSafe("ep-123.mp3")).toBe(true);
  });

  test("path traversal attempt is neutralised by basename stripping", () => {
    // basename("../../../etc/passwd") → "passwd", which resolves safely
    // inside the archive dir. The function returns true because the
    // sanitised name IS safe — traversal was stripped, not merely detected.
    expect(isPathSafe("../../../etc/passwd")).toBe(true);
  });

  test("nested path is reduced to basename", () => {
    // path.basename strips directories, so this resolves to just "passwd"
    // which IS inside the archive dir — that's correct, basename strips the traversal
    const safeName = path.basename("../../../etc/passwd");
    expect(safeName).toBe("passwd");
  });

  test("filename with no extension passes", () => {
    expect(isPathSafe("ep-abc")).toBe(true);
  });

  test("absolute path input is reduced to basename", () => {
    // Even if the client sends an absolute path, basename strips it
    const safeName = path.basename("/etc/shadow");
    expect(safeName).toBe("shadow");
  });
});
