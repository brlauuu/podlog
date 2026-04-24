import { test, expect } from "@playwright/test";

/**
 * Browser E2E smoke for the Meta-Analysis dashboard (#567).
 *
 * /meta-analysis mounts <MetaAnalysisClient/>, which fetches the
 * snapshot + missing-speakers coverage through the web-side proxy.
 * We stub both so the dashboard renders against deterministic fixtures.
 */

const MINIMAL_SNAPSHOT = {
  snapshot: {
    per_feed: [],
    per_episode: [],
    per_speaker: [],
    timeline_monthly: [],
    coverage: {
      host_share: { included_count: 0, excluded: [] },
      wpm_speaker: { included_count: 0, excluded: [] },
      tokens_chunks: { included_count: 0, excluded: [] },
    },
  },
  computed_at: new Date().toISOString(),
  episode_count: 0,
  feed_count: 0,
  is_stale: false,
  last_error: null,
};

test.describe("Meta-Analysis dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/meta-analysis/coverage/missing-speakers", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ podcasts: [] }),
      });
    });
  });

  test("empty snapshot renders every chart's no-data fallback", async ({ page }) => {
    await page.route("**/api/meta-analysis/snapshot", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MINIMAL_SNAPSHOT),
      });
    });

    await page.goto("/meta-analysis");

    // Each chart component emits its own fallback string when its
    // transform returns no rows. Hit a representative cross-section.
    for (const fallback of [
      /No dated episodes/i,
      /No feeds yet/i,
      /No processing data yet/i,
      /No remote inference spend/i,
      /No confirmed hosts yet/i,
      /No confirmed speakers yet/i,
      /No episode data/i,
    ]) {
      await expect(page.getByText(fallback).first()).toBeVisible();
    }
  });

  test("refresh button triggers the refresh endpoint and re-fetches", async ({ page }) => {
    let snapshotCalls = 0;
    const refreshCalls: string[] = [];

    await page.route("**/api/meta-analysis/snapshot", async (route) => {
      snapshotCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(MINIMAL_SNAPSHOT),
      });
    });

    await page.route("**/api/meta-analysis/refresh", async (route) => {
      refreshCalls.push(route.request().method());
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ ...MINIMAL_SNAPSHOT, is_stale: false }),
      });
    });

    await page.goto("/meta-analysis");
    await expect.poll(() => snapshotCalls).toBeGreaterThan(0);
    const before = snapshotCalls;

    await page.getByRole("button", { name: /refresh/i }).first().click();

    await expect.poll(() => refreshCalls.length).toBeGreaterThan(0);
    expect(refreshCalls[0]).toBe("POST");
    await expect.poll(() => snapshotCalls).toBeGreaterThan(before);
  });
});
