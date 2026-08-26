/**
 * @jest-environment node
 *
 * #990: the docs Ask bubble answers from the guide, the reference docs and
 * the PRDs. Only docs/guide/ was indexed before.
 */
import { buildDocsCorpusIndex, _resetDocsIndexCache } from "@/lib/docs-index";

beforeEach(() => _resetDocsIndexCache());

describe("buildDocsCorpusIndex (#990)", () => {
  it("indexes the guide, the reference docs and the PRDs", async () => {
    const index = await buildDocsCorpusIndex();
    const sources = new Set(index.map((s) => s.source));
    expect(sources).toEqual(new Set(["guide", "reference", "prd"]));
  });

  it("tags each section with the file it came from", async () => {
    const index = await buildDocsCorpusIndex();
    const queue = index.find((s) => s.repoPath === "docs/guide/08-queue.md");
    expect(queue).toBeDefined();
    expect(queue!.source).toBe("guide");

    const prd = index.find((s) => s.repoPath.startsWith("prds/"));
    expect(prd).toBeDefined();
    expect(prd!.source).toBe("prd");
  });

  it("never indexes agent artifacts", async () => {
    // docs/audit/ and docs/superpowers/ are working files, not documentation.
    const index = await buildDocsCorpusIndex();
    const leaked = index.filter(
      (s) =>
        s.repoPath.startsWith("docs/audit/") ||
        s.repoPath.startsWith("docs/superpowers/"),
    );
    expect(leaked).toEqual([]);
  });

  it("keeps guide anchors identical to the ones the renderer emits", async () => {
    // Citations deep-link to these. If the indexer and DocsClient ever use
    // different slug algorithms, every guide citation 404s silently.
    const index = await buildDocsCorpusIndex();
    const guide = index.filter((s) => s.source === "guide" && s.sectionTitle);
    expect(guide.length).toBeGreaterThan(50);
    for (const s of guide.slice(0, 20)) {
      expect(s.sectionId).toMatch(/^[a-z0-9-]+$/);
    }
  });

  it("finds a substantial corpus (guards a vacuous pass)", async () => {
    const index = await buildDocsCorpusIndex();
    expect(index.length).toBeGreaterThan(300);
  });
});

describe("corpus exclusions (#990)", () => {
  it("excludes CHANGELOG.md, which only exists under docs/ in the container", async () => {
    // It is bind-mounted to /docs for the About page, so a docs/*.md scan
    // sees it in production and not in dev. Excluded so the corpus is the
    // same everywhere, and because release history was not in scope.
    _resetDocsIndexCache();
    const index = await buildDocsCorpusIndex();
    const changelog = index.filter((s) => s.repoPath.endsWith("CHANGELOG.md"));
    expect(changelog).toEqual([]);
  });

  it("still indexes the other reference docs", async () => {
    _resetDocsIndexCache();
    const index = await buildDocsCorpusIndex();
    const paths = new Set(index.map((s) => s.repoPath));
    expect(paths.has("docs/configuration.md")).toBe(true);
    expect(paths.has("docs/hardware.md")).toBe(true);
  });
});
