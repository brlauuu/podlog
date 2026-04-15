# Docs Layout (Knowledge Base + Readability + Right TOC) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Update `/docs` to a readability-first 3-region layout: left "Knowledge base", center hard-capped article text, right "On this page" TOC.

**Architecture:** Keep server-side docs discovery unchanged (`docs/page.tsx` + `/api/docs/[slug]`) and implement layout + TOC entirely in `DocsClient.tsx`. Add pure helper functions for TOC extraction/slugging so behavior is testable in unit tests. Use responsive breakpoints so mobile remains simple and desktop gets full 3-column navigation.

**Tech Stack:** Next.js App Router, React, Tailwind CSS v4, react-markdown, Jest + Testing Library.

---

## File Structure

- Modify: `apps/web/src/app/docs/DocsClient.tsx`
- Modify: `apps/web/tests/unit/docs.test.tsx`
- Optional Modify (if smooth anchor scrolling chosen): `apps/web/src/app/globals.css`

Responsibilities:
- `DocsClient.tsx`: layout, left rail rename, article width cap, TOC extraction, TOC rendering, active section tracking.
- `docs.test.tsx`: regression coverage for renamed label, TOC behavior, and readability layout hooks.
- `globals.css` (optional): smooth in-page anchor scroll behavior.

### Task 1: Add Failing Tests For New Docs Layout Behavior

**Files:**
- Modify: `apps/web/tests/unit/docs.test.tsx`
- Test: `apps/web/tests/unit/docs.test.tsx`

- [ ] **Step 1: Add fixture markdown with H2/H3 headings**

```tsx
const markdownWithSections = `
# README

## Overview
Body

### Quick Start
Steps

## Troubleshooting
Fixes
`;
```

- [ ] **Step 2: Add failing test for left label rename**

```tsx
it("shows Knowledge base label", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({ ok: true, text: () => Promise.resolve("# README") });
  render(<DocsClient docs={mockDocs} />);
  expect(screen.getByText("Knowledge base")).toBeInTheDocument();
});
```

- [ ] **Step 3: Add failing tests for right-side TOC entries**

```tsx
it("renders On this page with h2/h3 entries from markdown", async () => {
  (global.fetch as jest.Mock).mockResolvedValue({
    ok: true,
    text: () => Promise.resolve(markdownWithSections),
  });

  render(<DocsClient docs={mockDocs} />);

  await waitFor(() => {
    expect(screen.getByText("On this page")).toBeInTheDocument();
  });
  expect(screen.getByRole("link", { name: "Overview" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Quick Start" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Troubleshooting" })).toBeInTheDocument();
});
```

- [ ] **Step 4: Run targeted unit tests and confirm failure**

Run: `cd apps/web && npm test -- --runInBand --testPathPattern=docs.test.tsx`
Expected: FAIL for missing `"Knowledge base"` and missing `"On this page"` section links.

- [ ] **Step 5: Commit failing tests**

```bash
git add apps/web/tests/unit/docs.test.tsx
git commit -m "test(docs): add failing coverage for knowledge base label and page TOC"
```

### Task 2: Implement 3-Region Responsive Layout And Readability Cap

**Files:**
- Modify: `apps/web/src/app/docs/DocsClient.tsx`
- Test: `apps/web/tests/unit/docs.test.tsx`

- [ ] **Step 1: Replace current 2-column wrapper with responsive 3-region grid**

Use:

```tsx
<div className="mx-auto w-full max-w-[1400px] px-4 py-6">
  <div className="grid grid-cols-1 gap-6 md:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[220px_minmax(0,1fr)_240px]">
```

- [ ] **Step 2: Rename sidebar heading from `Guide` to `Knowledge base`**

```tsx
<h2 className="mb-2 px-1 text-sm font-semibold text-muted-foreground">Knowledge base</h2>
```

- [ ] **Step 3: Hard-cap readable line length in center article column**

Use:

```tsx
<main className="min-w-0">
  <article className="prose prose-sm dark:prose-invert mx-auto max-w-[75ch] leading-7">
```

- [ ] **Step 4: Keep mobile behavior simple**

Retain existing mobile `<select>` doc switcher, keep TOC hidden below `xl` in this task.

- [ ] **Step 5: Run docs unit tests**

Run: `cd apps/web && npm test -- --runInBand --testPathPattern=docs.test.tsx`
Expected: Some tests still failing for TOC until Task 3.

- [ ] **Step 6: Commit layout/readability update**

```bash
git add apps/web/src/app/docs/DocsClient.tsx
git commit -m "feat(docs): adopt readability-first layout with knowledge base left rail"
```

### Task 3: Implement Right-Side “On This Page” TOC

**Files:**
- Modify: `apps/web/src/app/docs/DocsClient.tsx`
- Modify: `apps/web/tests/unit/docs.test.tsx`
- Test: `apps/web/tests/unit/docs.test.tsx`

- [ ] **Step 1: Add pure TOC helpers in `DocsClient.tsx`**

```tsx
export interface TocItem {
  id: string;
  text: string;
  level: 2 | 3;
}

export function slugifyHeading(text: string): string {
  return text.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/\s+/g, "-");
}

export function extractTocItems(markdown: string): TocItem[] {
  return markdown
    .split("\n")
    .map((line) => line.match(/^(##|###)\s+(.+)$/))
    .filter(Boolean)
    .map((match) => ({
      level: match![1] === "##" ? 2 : 3,
      text: match![2].trim(),
      id: slugifyHeading(match![2].trim()),
    }));
}
```

- [ ] **Step 2: Derive TOC from loaded markdown**

```tsx
const tocItems = useMemo(() => (content ? extractTocItems(content) : []), [content]);
```

- [ ] **Step 3: Render right rail (desktop `xl` only)**

```tsx
<aside className="hidden xl:block xl:w-[240px]">
  <div className="sticky top-20">
    <h2 className="mb-2 text-sm font-semibold text-muted-foreground">On this page</h2>
    <nav className="space-y-1">
      {tocItems.map((item) => (
        <a
          key={item.id}
          href={`#${item.id}`}
          className={item.level === 3 ? "ml-3 block text-sm text-muted-foreground hover:text-foreground" : "block text-sm hover:text-foreground"}
        >
          {item.text}
        </a>
      ))}
    </nav>
  </div>
</aside>
```

- [ ] **Step 4: Attach stable heading ids in markdown rendering**

In `ReactMarkdown` `components`, override `h2`/`h3` to set `id={slugifyHeading(text)}` so TOC links land correctly.

- [ ] **Step 5: Re-run docs tests**

Run: `cd apps/web && npm test -- --runInBand --testPathPattern=docs.test.tsx`
Expected: PASS for label rename and TOC entries.

- [ ] **Step 6: Commit TOC feature**

```bash
git add apps/web/src/app/docs/DocsClient.tsx apps/web/tests/unit/docs.test.tsx
git commit -m "feat(docs): add right-side on-this-page navigation for current document"
```

### Task 4: Polish Behavior And Full Verification

**Files:**
- Optional Modify: `apps/web/src/app/globals.css`
- Test: `apps/web/tests/unit/docs.test.tsx`

- [ ] **Step 1: Optional smooth anchor scroll**

If accepted:

```css
html {
  scroll-behavior: smooth;
}
```

- [ ] **Step 2: Run broader web checks**

Run:
- `cd apps/web && npm run lint`
- `cd apps/web && npm run typecheck`
- `cd apps/web && npm test -- --runInBand --testPathPattern=docs.test.tsx`

Expected:
- lint: no new errors
- typecheck: pass
- docs tests: pass

- [ ] **Step 3: Manual smoke test**

Run app and verify:
- Left rail heading reads `Knowledge base`
- Center text remains comfortably readable on large screens (not stretched)
- Right TOC appears on desktop and jumps to section anchors
- Mobile still supports doc switching via dropdown

- [ ] **Step 4: Commit polish (if CSS change added)**

```bash
git add apps/web/src/app/globals.css
git commit -m "style(docs): add smooth anchor scrolling for docs page navigation"
```

## Self-Review Checklist

- Spec coverage:
  - Rename `Guide` -> `Knowledge base`: covered in Task 2
  - Content hard-capped for readability: covered in Task 2
  - Right-side current-page content navigation: covered in Task 3
  - Responsive behavior: covered in Tasks 2-4
- Placeholder scan: no TODO/TBD placeholders remain in tasks.
- Type consistency: `TocItem`, `slugifyHeading`, and `extractTocItems` names are used consistently.
