# Episode Navigation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make episode detail pages show previous and next links within the same feed, ordered by `published_at` with fallback to `created_at`.

**Architecture:** Keep the adjacent-episode lookup in the episode page module and tighten its SQL so each episode uses a stable effective ordering key of `COALESCE(published_at, created_at)`. Cover the behavior with focused Jest tests that mock the DB layer and render the server page output.

**Tech Stack:** Next.js App Router, React, Jest, Testing Library, PostgreSQL query mocking

---

### Task 1: Add regression tests for adjacent episode navigation

**Files:**
- Create: `apps/web/tests/unit/episode-page-navigation.test.tsx`
- Modify: `apps/web/src/app/episodes/[id]/page.tsx`
- Test: `apps/web/tests/unit/episode-page-navigation.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("queries adjacent episodes within the same feed using published_at fallback to created_at", async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [currentEpisode] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [] });

  await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) });

  expect(mockQuery).toHaveBeenNthCalledWith(
    2,
    expect.stringContaining("COALESCE(published_at, created_at)"),
    ["2026-04-01T10:00:00.000Z", "feed-1", "ep-current"]
  );
  expect(mockQuery).toHaveBeenNthCalledWith(
    3,
    expect.stringContaining("COALESCE(published_at, created_at)"),
    ["2026-04-01T10:00:00.000Z", "feed-1", "ep-current"]
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runTestsByPath tests/unit/episode-page-navigation.test.tsx`
Expected: FAIL because the current SQL does not use `COALESCE(published_at, created_at)` and does not exclude the current row explicitly.

- [ ] **Step 3: Write minimal implementation**

```ts
const orderExpr = "COALESCE(published_at, created_at)";

const [prevResult, nextResult] = await Promise.all([
  pool.query(
    `SELECT id, title FROM episodes
     WHERE ${feedCondition}
       AND id <> $3
       AND (${orderExpr} < $1 OR (${orderExpr} = $1 AND id < $3))
     ORDER BY ${orderExpr} DESC, id DESC
     LIMIT 1`,
    [orderVal, episode.feed_id, episode.id]
  ),
  pool.query(
    `SELECT id, title FROM episodes
     WHERE ${feedCondition}
       AND id <> $3
       AND (${orderExpr} > $1 OR (${orderExpr} = $1 AND id > $3))
     ORDER BY ${orderExpr} ASC, id ASC
     LIMIT 1`,
    [orderVal, episode.feed_id, episode.id]
  ),
]);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runTestsByPath tests/unit/episode-page-navigation.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/unit/episode-page-navigation.test.tsx apps/web/src/app/episodes/[id]/page.tsx docs/superpowers/plans/2026-04-06-episode-navigation.md
git commit -m "feat: fix episode page navigation ordering"
```

### Task 2: Cover rendered previous/next links and boundary states

**Files:**
- Modify: `apps/web/tests/unit/episode-page-navigation.test.tsx`
- Test: `apps/web/tests/unit/episode-page-navigation.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
it("renders only the available navigation links for boundary episodes", async () => {
  mockQuery
    .mockResolvedValueOnce({ rows: [currentEpisode] })
    .mockResolvedValueOnce({ rows: [] })
    .mockResolvedValueOnce({ rows: [{ id: "ep-next", title: "Next episode" }] });

  render(await EpisodePage({ params: Promise.resolve({ id: "ep-current" }) }));

  expect(screen.queryByRole("link", { name: /previous episode/i })).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: /next episode/i })).toHaveAttribute(
    "href",
    "/episodes/ep-next"
  );
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- --runTestsByPath tests/unit/episode-page-navigation.test.tsx`
Expected: FAIL until the test harness correctly mocks child components and the page renders deterministic navigation labels.

- [ ] **Step 3: Write minimal implementation**

```tsx
<span className="truncate">{prev.title ?? "Previous episode"}</span>
<span className="truncate">{next.title ?? "Next episode"}</span>
```

No product code change should be needed beyond preserving these labels while adjusting the query logic.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- --runTestsByPath tests/unit/episode-page-navigation.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/tests/unit/episode-page-navigation.test.tsx
git commit -m "test: cover episode page navigation states"
```
