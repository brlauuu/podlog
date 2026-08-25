import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";

/**
 * Guard for #412: every in-app `/docs?page=<slug>` deep link must name a real
 * page under `docs/guide/`.
 *
 * DocsClient silently falls back to the guide index when `page` matches no
 * document, so a wrong slug produces no error, no 404, and no broken-link
 * warning — it just quietly lands the user on the wrong page. That is how
 * ExploreStatusPanel shipped pointing at `16-explore` (the Backups page
 * number) instead of `15-explore`, with a unit test asserting the wrong
 * value.
 */

const SRC_DIR = join(__dirname, "..", "..", "src");
const GUIDE_DIR = join(__dirname, "..", "..", "..", "..", "docs", "guide");

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

function guideSlugs(): Set<string> {
  return new Set(
    readdirSync(GUIDE_DIR)
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, "")),
  );
}

/** Collect every literal `/docs?page=<slug>` occurrence with its source file. */
function collectDeepLinks(): { file: string; slug: string }[] {
  const found: { file: string; slug: string }[] = [];
  for (const file of walk(SRC_DIR)) {
    const source = readFileSync(file, "utf-8");
    // Only literal slugs; template-interpolated ones are resolved at runtime
    // from the same docs listing and cannot be checked statically.
    for (const match of source.matchAll(/\/docs\?page=([A-Za-z0-9_-]+)/g)) {
      found.push({ file, slug: match[1] });
    }
  }
  return found;
}

describe("in-app docs deep links", () => {
  test("every /docs?page= slug resolves to a file in docs/guide/", () => {
    const slugs = guideSlugs();
    const broken = collectDeepLinks()
      .filter((link) => !slugs.has(link.slug))
      .map((link) => `${link.file.replace(SRC_DIR, "src")} -> ${link.slug}`);

    expect(broken).toEqual([]);
  });

  test("the guide directory is actually readable (guards a vacuous pass)", () => {
    // If GUIDE_DIR were wrong, guideSlugs() would throw rather than return an
    // empty set -- but assert non-empty anyway so a future refactor that makes
    // it return [] cannot turn the test above into a no-op.
    expect(guideSlugs().size).toBeGreaterThan(0);
  });

  test("at least one deep link exists to check (guards a vacuous pass)", () => {
    expect(collectDeepLinks().length).toBeGreaterThan(0);
  });
});
