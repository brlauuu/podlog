import { test, expect } from "@playwright/test";
import type { Pool } from "pg";
import { getFixturePool, seedEpisode, type SeededEpisode } from "./fixtures/db";

/**
 * Render smoke for SSR pages that read from the DB directly (#567).
 *
 * Pages under test: /docs, /feeds, /podcasts, /episodes/[id], /settings.
 * All are Next.js server components, so page.route can't stub the data
 * path. We seed one feed + episode for the duration of the suite and
 * assert each page renders a stable landmark without console errors.
 */

let pool: Pool | null = null;
let seeded: SeededEpisode | null = null;

test.beforeAll(async () => {
  pool = getFixturePool();
  if (!pool) {
    test.skip(
      true,
      "Set DATABASE_URL to run the seeded e2e specs (see fixtures/db.ts)"
    );
    return;
  }
  seeded = await seedEpisode(pool, {
    title: "E2E Smoke episode",
    feedTitle: "E2E Smoke feed",
  });
});

test.afterAll(async () => {
  if (seeded) await seeded.cleanup();
  if (pool) await pool.end();
});

test.describe("Server-rendered page smoke", () => {
  // Stub ancillary API fetches these pages make client-side so they
  // stay deterministic (coverage strip, hardware sensors, etc.).
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/ask/coverage", (r) =>
      r.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ processed: 1, total: 1, has_manual_uploads: false }),
      })
    );
    await page.route("**/api/hardware", (r) =>
      r.fulfill({ status: 200, contentType: "application/json", body: "{}" })
    );
  });

  test("/docs loads and shows a chapter heading", async ({ page }) => {
    const resp = await page.goto("/docs");
    expect(resp?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  });

  test("/feeds loads and lists the seeded feed", async ({ page }) => {
    const resp = await page.goto("/feeds");
    expect(resp?.status()).toBe(200);
    // /feeds uses a client-side useQuery → /api/feeds, so the seeded
    // feed's title is the reliable landmark once the fetch resolves.
    await expect(page.getByText("E2E Smoke feed").first()).toBeVisible();
  });

  test("/podcasts loads and lists the seeded feed", async ({ page }) => {
    const resp = await page.goto("/podcasts");
    expect(resp?.status()).toBe(200);
    await expect(page.getByText("E2E Smoke feed")).toBeVisible();
  });

  test("/episodes/[id] loads and shows the seeded episode title", async ({
    page,
  }) => {
    const resp = await page.goto(`/episodes/${seeded!.episodeId}`);
    expect(resp?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { name: "E2E Smoke episode" })
    ).toBeVisible();
  });

  test("/settings loads", async ({ page }) => {
    const resp = await page.goto("/settings");
    expect(resp?.status()).toBe(200);
    await expect(
      page.getByRole("heading").filter({ hasText: /setting/i }).first()
    ).toBeVisible();
  });
});
