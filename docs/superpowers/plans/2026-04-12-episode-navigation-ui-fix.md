# Episode Navigation UI Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Redesign episode page navigation buttons to meet in middle with monochromatic button style

**Architecture:** Update episode page navigation section to use button-style links with flex-1 stretching when both present, natural width when single

**Tech Stack:** Next.js, React, Tailwind CSS, Lucide icons

---

### Task 1: Update episode navigation in page.tsx

**Files:**
- Modify: `apps/web/src/app/episodes/[id]/page.tsx:238-263`

- [ ] **Step 1: Read current navigation code**

Review lines 238-263 in `apps/web/src/app/episodes/[id]/page.tsx` to understand current implementation.

- [ ] **Step 2: Replace navigation section**

Replace the entire navigation section (lines 238-263) with:

```tsx
      {/* Episode navigation */}
      {(prev || next) && (
        <div className="flex justify-center gap-2">
          {prev && (
            <Link
              href={`/episodes/${prev.id}`}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors ${next ? 'flex-1' : ''} max-w-[50%]`}
            >
              <ChevronLeft size={16} className="shrink-0" />
              <span className="truncate">{prev.title ?? "Previous episode"}</span>
            </Link>
          )}
          {next && (
            <Link
              href={`/episodes/${next.id}`}
              className={`inline-flex items-center gap-2 px-5 py-2.5 rounded-lg border border-input bg-background text-foreground font-medium text-sm hover:bg-accent transition-colors ${prev ? 'flex-1' : ''} max-w-[50%]`}
            >
              <span className="truncate">{next.title ?? "Next episode"}</span>
              <ChevronRight size={16} className="shrink-0" />
            </Link>
          )}
        </div>
      )}
```

Key changes:
- Uses `justify-center` to center buttons
- `gap-2` for small gap between buttons
- `flex-1` only when both prev and next exist (using conditional class)
- `max-w-[50%]` to prevent overflow
- `truncate` for long titles
- Matches landing page button style exactly
- Chevrons inside buttons with proper direction

- [ ] **Step 3: Run typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: No errors

- [ ] **Step 4: Run linter**

```bash
cd apps/web && npm run lint
```

Expected: No new errors

- [ ] **Step 5: Run tests**

```bash
cd apps/web && npm run test
```

Expected: All tests pass (currently 139)

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/app/episodes/[id]/page.tsx
git commit -m "feat: redesign episode navigation with button style (#358)"
```

---

### Task 2: Add unit tests for navigation behavior

**Files:**
- Modify: `apps/web/tests/unit/episode-page-navigation.test.tsx`

- [ ] **Step 1: Add test for both prev and next buttons**

Add to existing test file after line 163:

```tsx
  it("renders previous and next as button-style links with flex layout", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-prev", title: "Previous episode title" }] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: "Next episode title" }] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const prevLink = screen.getByRole("link", { name: /previous episode title/i });
    const nextLink = screen.getByRole("link", { name: /next episode title/i });

    // Both links should have button-style classes
    expect(prevLink).toHaveClass("rounded-lg", "border", "border-input", "bg-background");
    expect(nextLink).toHaveClass("rounded-lg", "border", "border-input", "bg-background");

    // Both should have flex-1 when both present
    expect(prevLink).toHaveClass("flex-1");
    expect(nextLink).toHaveClass("flex-1");
  });

  it("renders only previous button at natural width when no next episode", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-prev", title: "Previous episode" }] })
      .mockResolvedValueOnce({ rows: [] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const prevLink = screen.getByRole("link", { name: /previous episode/i });
    expect(prevLink).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /next episode/i })).not.toBeInTheDocument();

    // Should NOT have flex-1 when alone
    expect(prevLink).not.toHaveClass("flex-1");
  });

  it("renders only next button at natural width when no previous episode", async () => {
    mockQuery
      .mockResolvedValueOnce({ rows: [currentEpisode] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: "Next episode" }] });

    render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

    const nextLink = screen.getByRole("link", { name: /next episode/i });
    expect(nextLink).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /previous episode/i })).not.toBeInTheDocument();

    // Should NOT have flex-1 when alone
    expect(nextLink).not.toHaveClass("flex-1");
  });
```

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npm run test -- episode-page-navigation
```

Expected: All tests pass including new ones

- [ ] **Step 3: Commit**

```bash
git add apps/web/tests/unit/episode-page-navigation.test.tsx
git commit -m "test: add navigation button layout tests (#358)"
```

---

## Spec Coverage Check

- ✅ Button style matching landing page (rounded-lg, border, hover:bg-accent)
- ✅ Both buttons stretch with flex-1 when both present
- ✅ Single button stays at natural width (no flex-1)
- ✅ Chevron icons inside buttons
- ✅ Truncated titles for long episode names
- ✅ Container centered with justify-center

## Placeholder Scan

- No "TBD", "TODO", or incomplete sections
- No vague requirements
- Exact code provided for all changes
- Exact commands with expected output