/**
 * Build the docs search index server-side.
 *
 * Reads every `.md` file under `docs/guide/`, splits each into sections at
 * `## ` and `### ` headings, and emits a flat array consumed by the client
 * search UI in DocsClient. Section anchor IDs are produced by the same
 * slug algorithm DocsClient uses when rendering headings, so a result's
 * link resolves to the heading the user expects.
 *
 * The result is memoized at module level so we don't re-read the corpus on
 * every render — `force-dynamic` on the page would otherwise mean fresh
 * filesystem reads on every request.
 */
import { readdir, readFile } from "fs/promises";
import { join } from "path";

import type { DocSection, DocSource } from "./docs-search";
import { makeUniqueSlugger } from "./docs-slug";

function filenameToTitle(filename: string): string {
  // Keep in step with the same helper in @/app/docs/page.tsx -- search hits
  // label their source document with this, so a mismatch would show the
  // index under a different name in search results than in the sidebar.
  if (filename === "README") return "Overview";
  return filename
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Split a single document into ## / ### sections. */
function splitDocIntoSections(
  docSlug: string,
  docTitle: string,
  markdown: string,
  source: DocSource = "guide",
  repoPath = `docs/guide/${docSlug}.md`,
): DocSection[] {
  const lines = markdown.split("\n");
  const sluggify = makeUniqueSlugger();
  const sections: DocSection[] = [];

  // Anything before the first ## heading goes into a synthetic preamble
  // section so it remains searchable. Its anchor matches the doc itself.
  let current: DocSection = {
    docSlug,
    docTitle,
    sectionId: "",
    sectionTitle: "",
    level: 0,
    source,
    repoPath,
    content: "",
  };

  const flush = () => {
    if (current.content.trim() || current.sectionTitle) {
      sections.push({ ...current, content: current.content.trim() });
    }
  };

  for (const line of lines) {
    const match = line.match(/^(##|###)\s+(.+)$/);
    if (match) {
      flush();
      const level = match[1] === "##" ? 2 : 3;
      const text = match[2].trim();
      current = {
        docSlug,
        docTitle,
        sectionId: sluggify(text),
        sectionTitle: text,
        level,
        source,
        repoPath,
        content: "",
      };
      continue;
    }
    current.content += (current.content ? "\n" : "") + line;
  }
  flush();

  return sections;
}

let cachedIndex: DocSection[] | null = null;

/** Reads the docs corpus and returns the flat search index. Memoized. */
export async function buildDocsIndex(): Promise<DocSection[]> {
  if (cachedIndex) return cachedIndex;

  const docsDir = join(process.cwd(), "..", "..", "docs", "guide");
  let files: string[] = [];
  try {
    files = (await readdir(docsDir)).filter((f) => f.endsWith(".md")).sort();
  } catch {
    cachedIndex = [];
    return cachedIndex;
  }

  const out: DocSection[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const title = filenameToTitle(slug);
    let raw = "";
    try {
      raw = await readFile(join(docsDir, file), "utf-8");
    } catch {
      continue;
    }
    out.push(...splitDocIntoSections(slug, title, raw));
  }

  cachedIndex = out;
  return cachedIndex;
}

const REPO_ROOT = join(process.cwd(), "..", "..");

interface CorpusEntry {
  /** Absolute directory to scan, non-recursively. */
  dir: string;
  /** Repo-relative prefix used to build DocSection.repoPath. */
  repoDir: string;
  source: DocSource;
}

/**
 * Filenames excluded from the corpus even though they sit in a scanned
 * directory.
 *
 * CHANGELOG.md lives at the repo root but is bind-mounted to /docs in the
 * web container so the About page can render it. That makes it visible to a
 * `docs/*.md` scan in production and invisible in dev and tests -- the same
 * code would build a different corpus depending on where it runs. It is
 * excluded outright rather than left to differ, and release history was not
 * part of the corpus this feature was scoped to.
 */
const CORPUS_EXCLUDE = new Set(["CHANGELOG.md"]);

/**
 * The corpus the docs Ask bubble answers from (#990).
 *
 * Non-recursive per directory on purpose: `docs/` must pick up
 * docs/configuration.md and its siblings, but never docs/audit/ or
 * docs/superpowers/, which are agent working files rather than
 * documentation. A recursive walk would quietly pull both in.
 */
const CORPUS: CorpusEntry[] = [
  { dir: join(REPO_ROOT, "docs", "guide"), repoDir: "docs/guide", source: "guide" },
  { dir: join(REPO_ROOT, "docs"), repoDir: "docs", source: "reference" },
  { dir: join(REPO_ROOT, "prds"), repoDir: "prds", source: "prd" },
];

let cachedCorpus: DocSection[] | null = null;

/**
 * Build the full documentation corpus: guide, reference docs and PRDs,
 * split into heading-delimited sections (#990).
 *
 * Separate from buildDocsIndex(), which backs the /docs search UI and must
 * keep returning guide sections only. Memoized the same way; a missing
 * directory is skipped rather than fatal, so a checkout without prds/
 * degrades to a smaller corpus instead of failing the request.
 */
export async function buildDocsCorpusIndex(): Promise<DocSection[]> {
  if (cachedCorpus) return cachedCorpus;

  const out: DocSection[] = [];
  for (const entry of CORPUS) {
    let files: string[] = [];
    try {
      files = (await readdir(entry.dir, { withFileTypes: true }))
        .filter(
          (d) =>
            d.isFile() &&
            d.name.endsWith(".md") &&
            !CORPUS_EXCLUDE.has(d.name),
        )
        .map((d) => d.name)
        .sort();
    } catch {
      continue;
    }

    for (const file of files) {
      const slug = file.replace(/\.md$/, "");
      let raw = "";
      try {
        raw = await readFile(join(entry.dir, file), "utf-8");
      } catch {
        continue;
      }
      out.push(
        ...splitDocIntoSections(
          slug,
          filenameToTitle(slug),
          raw,
          entry.source,
          `${entry.repoDir}/${file}`,
        ),
      );
    }
  }

  cachedCorpus = out;
  return cachedCorpus;
}

/** Test hook to force a re-read on the next call. Not used in app code. */
export function _resetDocsIndexCache(): void {
  cachedIndex = null;
  cachedCorpus = null;
}

export { splitDocIntoSections };
