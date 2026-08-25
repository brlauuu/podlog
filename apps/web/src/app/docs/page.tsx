import { readdir } from "fs/promises";
import { join } from "path";
import { Suspense } from "react";
import DocsClient from "./DocsClient";
import { buildDocsIndex } from "@/lib/docs-index";

export const dynamic = "force-dynamic";

function filenameToTitle(filename: string): string {
  // #412: the guide index is README.md on disk so it renders on GitHub too,
  // but "README" is a filename, not a page name. Label it for readers.
  if (filename === "README") return "Overview";
  return filename
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function DocsPage() {
  const docsDir = join(process.cwd(), "..", "..", "docs", "guide");

  let docs: { name: string; title: string }[] = [];

  try {
    const files = await readdir(docsDir);
    docs = files
      .filter((f) => f.endsWith(".md"))
      // #412: plain .sort() puts README last ("0" < "R"), burying the guide
      // index at the bottom of the sidebar even though it is the default
      // page. Pin it first; the numbered pages sort naturally after it.
      .sort((a, b) => {
        if (a === "README.md") return -1;
        if (b === "README.md") return 1;
        return a.localeCompare(b);
      })
      .map((name) => ({
        name: name.replace(/\.md$/, ""),
        title: filenameToTitle(name.replace(/\.md$/, "")),
      }));
  } catch {
    // Directory doesn't exist or is empty
  }

  const searchIndex = await buildDocsIndex();

  return (
    <Suspense fallback={<div className="p-6 text-muted-foreground">Loading...</div>}>
      <DocsClient docs={docs} searchIndex={searchIndex} />
    </Suspense>
  );
}
