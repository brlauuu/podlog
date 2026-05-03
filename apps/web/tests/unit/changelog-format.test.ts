import { readFileSync } from "fs";
import { join } from "path";

/**
 * Locks in the heading format the About page depends on (#644).
 *
 * react-markdown renders `## [0.3.0] — 2026-04-24` with the bracketed
 * portion as an `<a>` element (because of keepachangelog reference-link
 * defs). The h2 component callback then receives text without the
 * brackets, but the slug map in `apps/web/src/app/about/page.tsx` is
 * keyed by the raw markdown text — including the brackets. The lookup
 * misses, the heading renders without an `id`, and the right-rail TOC
 * #-anchors point at nothing.
 *
 * Keeping version headings as bare semver (no reference-link syntax)
 * sidesteps the drift entirely.
 */
describe("CHANGELOG.md heading format", () => {
  const path = join(__dirname, "..", "..", "..", "..", "CHANGELOG.md");
  const content = readFileSync(path, "utf-8");

  const versionHeadings = content
    .split("\n")
    .filter((line) => /^## /.test(line));

  it("has at least one version-level heading", () => {
    expect(versionHeadings.length).toBeGreaterThan(0);
  });

  it("uses bare semver / 'Unreleased' for every version heading (no bracketed reference-link syntax)", () => {
    const offenders = versionHeadings.filter((line) => /\[|\]/.test(line));
    expect(offenders).toEqual([]);
  });

  it("does not contain reference-link definitions pointing at non-existent compare URLs", () => {
    // Lines like `[0.3.0]: https://github.com/.../compare/v0.2.0...v0.3.0`.
    // The project has no `v*` git tags, so each one resolved to a 404
    // (#644). They should stay deleted.
    const refLinkDefs = content
      .split("\n")
      .filter((line) => /^\[[^\]]+\]:\s*https?:\/\//.test(line));
    expect(refLinkDefs).toEqual([]);
  });
});
