# Docs Tab + Wizard Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the wizard with a `/docs` page that renders markdown guides from `docs/guide/` with sidebar navigation.

**Architecture:** Server component reads filesystem to get doc list; client component handles sidebar + markdown rendering with `react-markdown`. Internal `.md` links are rewritten to query params.

**Tech Stack:** Next.js App Router, `react-markdown`, `remark-gfm`, `rehype-raw`, `@tailwindcss/typography`

---

## File Structure

```
apps/web/src/app/docs/
  page.tsx              # Server component: reads filesystem
  DocsClient.tsx        # Client component: sidebar + content

apps/web/src/app/layout.tsx  # MODIFY: remove wizard
apps/web/src/components/Navbar.tsx  # MODIFY: add Docs link, remove HelpMenu

DELETE:
  apps/web/src/components/SetupWizard.tsx
  apps/web/src/components/WizardProvider.tsx
  apps/web/src/components/WizardHealthCheck.tsx
  apps/web/src/components/WizardAddFeed.tsx
  apps/web/src/components/WizardComplete.tsx
  apps/web/src/components/HelpMenu.tsx
  apps/web/src/app/api/wizard/status/route.ts
  apps/web/tests/unit/setup-wizard.test.tsx
  apps/web/tests/unit/wizard-status-route.test.ts
```

---

## Tasks

### Task 1: Install dependencies

**Files:**
- Modify: `apps/web/package.json`

- [ ] **Step 1: Add react-markdown dependencies**

Run: `cd apps/web && npm install react-markdown remark-gfm rehype-raw`

- [ ] **Step 2: Commit**

```bash
cd apps/web
git add package.json package-lock.json
git commit -m "deps: add react-markdown for docs tab rendering"
```

---

### Task 2: Create DocsClient component

**Files:**
- Create: `apps/web/src/app/docs/DocsClient.tsx`

- [ ] **Step 1: Create DocsClient.tsx**

```tsx
"use client";

import { useState, useEffect } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";

interface DocEntry {
  name: string;        // filename without extension, e.g. "01-installation"
  title: string;       // display title, e.g. "Installation"
}

interface DocsClientProps {
  docs: DocEntry[];
  defaultContent: string;
}

function filenameToTitle(filename: string): string {
  // "01-installation" -> "Installation"
  // "README" -> "README"
  return filename
    .replace(/^\d+-/, "")  // remove leading "01-"
    .replace(/-/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function DocsClient({ docs, defaultContent }: DocsClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const currentPage = searchParams.get("page") || "README";

  // Fetch doc content when page changes
  useEffect(() => {
    const fetchContent = async () => {
      setLoading(true);
      try {
        const resp = await fetch(`/docs/${currentPage}.md`);
        if (resp.ok) {
          setContent(await resp.text());
        } else {
          setContent(null);
        }
      } catch {
        setContent(null);
      } finally {
        setLoading(false);
      }
    };
    fetchContent();
  }, [currentPage]);

  // Transform internal .md links to ?page= query params
  const transformLink = (href: string | undefined): string | undefined => {
    if (!href || !href.endsWith(".md")) return href;
    const name = href.replace(/\.md$/, "");
    return `?page=${name}`;
  };

  return (
    <div className="flex gap-6 max-w-6xl mx-auto px-4 py-6">
      {/* Sidebar */}
      <aside className="w-52 shrink-0">
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 px-2">Guide</h2>
        <nav className="space-y-1">
          {docs.map((doc) => (
            <button
              key={doc.name}
              onClick={() => router.push(`/docs?page=${doc.name}`)}
              className={`w-full text-left px-2 py-1.5 rounded-md text-sm transition-colors ${
                currentPage === doc.name
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              }`}
            >
              {doc.title}
            </button>
          ))}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 min-w-0">
        {loading ? (
          <div className="text-muted-foreground">Loading...</div>
        ) : content ? (
          <article className="prose prose-sm max-w-none dark:prose-invert">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeRaw]}
              components={{
                a: ({ href, children }) => (
                  <a href={transformLink(href as string | undefined)}>
                    {children}
                  </a>
                ),
              }}
            >
              {content}
            </ReactMarkdown>
          </article>
        ) : (
          <div className="text-muted-foreground">
            <h1 className="text-2xl font-bold mb-4">Documentation</h1>
            <p>Could not load the requested page.</p>
          </div>
        )}
      </main>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/docs/DocsClient.tsx
git commit -m "feat(docs): create DocsClient component with sidebar and markdown rendering"
```

---

### Task 3: Create Docs page (server component)

**Files:**
- Create: `apps/web/src/app/docs/page.tsx`

- [ ] **Step 1: Create docs/page.tsx**

```tsx
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
  let defaultContent = "";

  try {
    const files = await readdir(docsDir);
    docs = files
      .filter((f) => f.endsWith(".md"))
      .sort()
      .map((name) => ({
        name: name.replace(/\.md$/, ""),
        title: filenameToTitle(name.replace(/\.md$/, "")),
      }));

    // Load README by default
    const readmePath = join(docsDir, "README.md");
    defaultContent = await readFile(readmePath, "utf-8");
  } catch {
    // Directory doesn't exist or is empty
  }

  return <DocsClient docs={docs} defaultContent={defaultContent} />;
}
```

- [ ] **Step 2: Create API route to serve markdown files**

Create: `apps/web/src/app/api/docs/[slug]/route.ts`

```ts
import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const filename = slug + ".md";
  const docsDir = join(process.cwd(), "docs", "guide");

  try {
    const filePath = join(docsDir, filename);
    const content = await readFile(filePath, "utf-8");
    return new NextResponse(content, {
      headers: { "Content-Type": "text/markdown" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
```

- [ ] **Step 3: Update DocsClient to fetch from API route**

In `apps/web/src/app/docs/DocsClient.tsx`, change the fetch URL:

```tsx
const resp = await fetch(`/api/docs/${currentPage}`);
```

- [ ] **Step 4: Commit docs page and API route**

```bash
git add apps/web/src/app/docs/page.tsx apps/web/src/app/docs/DocsClient.tsx apps/web/src/app/api/docs/[slug]/route.ts
git commit -m "feat(docs): add docs page with server-side doc list and API route"
```

---

### Task 4: Update Navbar

**Files:**
- Modify: `apps/web/src/components/Navbar.tsx`

- [ ] **Step 1: Update NAV_LINKS to include Docs**

```tsx
const NAV_LINKS = [
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask" },
  { href: "/podcasts", label: "Sources" },
  { href: "/queue", label: "Queue" },
  { href: "/settings", label: "Settings" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
];
```

Remove the HelpMenu import and usage:

```tsx
// Remove: import HelpMenu from "@/components/HelpMenu";
// Remove: <HelpMenu />
```

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/components/Navbar.tsx
git commit -m "feat(nav): add Docs link and remove HelpMenu"
```

---

### Task 5: Update layout.tsx

**Files:**
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Remove wizard imports and usage**

Remove these lines:
```tsx
import WizardProvider from "@/components/WizardProvider";
import SetupWizard from "@/components/SetupWizard";
```

Remove from JSX:
```tsx
<WizardProvider>
  ...
</WizardProvider>
```

And remove `<SetupWizard />`.

- [ ] **Step 2: Commit**

```bash
git add apps/web/src/app/layout.tsx
git commit -m "chore: remove wizard from layout"
```

---

### Task 6: Delete wizard files

**Files:**
- Delete: `apps/web/src/components/SetupWizard.tsx`
- Delete: `apps/web/src/components/WizardProvider.tsx`
- Delete: `apps/web/src/components/WizardHealthCheck.tsx`
- Delete: `apps/web/src/components/WizardAddFeed.tsx`
- Delete: `apps/web/src/components/WizardComplete.tsx`
- Delete: `apps/web/src/components/HelpMenu.tsx`

- [ ] **Step 1: Delete wizard components**

```bash
rm apps/web/src/components/SetupWizard.tsx
rm apps/web/src/components/WizardProvider.tsx
rm apps/web/src/components/WizardHealthCheck.tsx
rm apps/web/src/components/WizardAddFeed.tsx
rm apps/web/src/components/WizardComplete.tsx
rm apps/web/src/components/HelpMenu.tsx
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: delete wizard components"
```

---

### Task 7: Delete wizard API route

**Files:**
- Delete: `apps/web/src/app/api/wizard/status/route.ts` (entire directory)

- [ ] **Step 1: Delete wizard API route**

```bash
rm -rf apps/web/src/app/api/wizard
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: delete wizard API route"
```

---

### Task 8: Delete wizard tests

**Files:**
- Delete: `apps/web/tests/unit/setup-wizard.test.tsx`
- Delete: `apps/web/tests/unit/wizard-status-route.test.ts`

- [ ] **Step 1: Delete wizard test files**

```bash
rm apps/web/tests/unit/setup-wizard.test.tsx
rm apps/web/tests/unit/wizard-status-route.test.ts
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "chore: delete wizard test files"
```

---

### Task 9: Add unit tests for docs

**Files:**
- Create: `apps/web/tests/unit/docs.test.tsx`

- [ ] **Step 1: Write tests**

```tsx
/**
 * @jest-environment jsdom
 */
import { render, screen } from "@testing-library/react";
import DocsClient from "@/app/docs/DocsClient";

// Mock useSearchParams
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useSearchParams: () => ({
    get: () => "README",
  }),
  useRouter: () => ({
    push: mockPush,
  }),
}));

// Mock fetch
global.fetch = jest.fn() as jest.Mock;

describe("DocsClient", () => {
  const mockDocs = [
    { name: "README", title: "README" },
    { name: "01-installation", title: "Installation" },
    { name: "02-first-run", title: "First Run" },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: true,
      text: () => Promise.resolve("# Test Doc\n\nHello world"),
    });
  });

  it("renders sidebar with all docs", async () => {
    render(<DocsClient docs={mockDocs} defaultContent="# Test" />);
    
    expect(screen.getByText("README")).toBeInTheDocument();
    expect(screen.getByText("Installation")).toBeInTheDocument();
    expect(screen.getByText("First Run")).toBeInTheDocument();
  });

  it("renders markdown content", async () => {
    render(<DocsClient docs={mockDocs} defaultContent="# Test" />);
    
    await screen.findByText("Test Doc");
    expect(screen.getByText("Hello world")).toBeInTheDocument();
  });

  it("shows loading state while fetching", async () => {
    (global.fetch as jest.Mock).mockImplementation(
      () => new Promise(() => {}) // never resolves
    );
    
    render(<DocsClient docs={mockDocs} defaultContent="# Test" />);
    
    expect(screen.getByText("Loading...")).toBeInTheDocument();
  });

  it("shows error state when doc not found", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
      ok: false,
    });
    
    render(<DocsClient docs={mockDocs} defaultContent="# Test" />);
    
    await screen.findByText("Could not load the requested page.");
  });
});
```

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npm test -- --testPathPattern=docs.test.tsx
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/unit/docs.test.tsx
git commit -m "test(docs): add unit tests for docs page"
```

---

### Task 10: Update documentation references

**Files:**
- Modify: `CLAUDE.md` — remove SetupWizard from component list, add docs page

- [ ] **Step 1: Update CLAUDE.md**

Remove from components list:
```
SetupWizard, WizardHealthCheck, WizardAddFeed, WizardComplete, WizardProvider, HelpMenu
```

Add:
```
DocsClient, docs/page
```

- [ ] **Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for docs tab"
```

---

## Verification

After all tasks, run:

```bash
cd apps/web && npm run build
```

Expected: Build succeeds with no errors about missing wizard imports.

```bash
npm test
```

Expected: All tests pass (wizard tests deleted, docs tests added).

---

## Summary

| Task | Description |
|------|-------------|
| 1 | Install react-markdown dependencies |
| 2 | Create DocsClient component |
| 3 | Create docs page + API route |
| 4 | Update Navbar (add Docs, remove HelpMenu) |
| 5 | Update layout (remove wizard) |
| 6 | Delete wizard components |
| 7 | Delete wizard API route |
| 8 | Delete wizard tests |
| 9 | Add docs unit tests |
| 10 | Update CLAUDE.md |
