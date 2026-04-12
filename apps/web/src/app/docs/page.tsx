import { readdir, readFile } from "fs/promises";
import { join } from "path";
import DocsClient from "./DocsClient";

function filenameToTitle(filename: string): string {
  return filename
    .replace(/^\d+-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default async function DocsPage() {
  const docsDir = join(process.cwd(), "docs", "guide");

  let docs: { name: string; title: string }[] = [];

  try {
    const files = await readdir(docsDir);
    docs = files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((name) => ({
        name: name.replace(/\.md$/, ""),
        title: filenameToTitle(name.replace(/\.md$/, "")),
      }));
  } catch {
    // Directory doesn't exist or is empty
  }

  return <DocsClient docs={docs} />;
}
