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

import type { DocSection } from "./docs-search";
import { makeUniqueSlugger } from "./docs-slug";

function filenameToTitle(filename: string): string {
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

/** Test hook to force a re-read on the next call. Not used in app code. */
export function _resetDocsIndexCache(): void {
  cachedIndex = null;
}

export { splitDocIntoSections };
