import { test, expect } from "@playwright/test";

/**
 * Browser E2E smoke for search UX.
 * Uses route stubs so tests remain runnable without seeded backend data.
 */
test.beforeEach(async ({ page }) => {
  await page.route("**/api/feeds", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
    });
  });

  await page.route("**/api/ask/coverage", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ processed: 0, total: 0 }),
    });
  });
});

test.describe("Search", () => {
  test("typing a query returns grouped results", async ({ page }) => {
    await page.route("**/api/search/grouped?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          feeds: [],
          totalFeeds: 1,
          totalEpisodes: 1,
          totalMentions: 1,
          coverage: { processed: 1, total: 1 },
        }),
      });
    });

    await page.goto("/search");
    await page.getByPlaceholder("Search transcripts...").fill("machine learning");
    await page.keyboard.press("Enter");

    await expect(page.getByText("Found in 1 podcast, 1 episode (1 mention)")).toBeVisible();
  });

  test("empty state shown when no results", async ({ page }) => {
    await page.route("**/api/search/grouped?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          feeds: [],
          totalFeeds: 0,
          totalEpisodes: 0,
          totalMentions: 0,
          coverage: { processed: 0, total: 0 },
        }),
      });
    });

    await page.goto("/search");
    await page.getByPlaceholder("Search transcripts...").fill("xyzzy_no_match_42");
    await page.keyboard.press("Enter");

    await expect(page.getByText(/No results for/i)).toBeVisible();
  });
});

test.describe("Dark mode", () => {
  test("toggle switches theme and persists on reload", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: /switch to (dark|light) mode/i });

    await toggle.click();
    await expect(html).toHaveClass(/dark/);

    await page.reload();
    await expect(html).toHaveClass(/dark/);
  });
});
