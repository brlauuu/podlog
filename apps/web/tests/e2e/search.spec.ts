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

  await page.route("**/api/search/speakers?**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: "[]",
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
    await page.getByRole("textbox").fill("machine learning");
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
    await page.getByRole("textbox").fill("xyzzy_no_match_42");
    await page.keyboard.press("Enter");

    await expect(page.getByText(/No results for/i)).toBeVisible();
  });

  test("supports grouped pagination and page-size selection", async ({ page }) => {
    const groupedRequests: string[] = [];

    await page.route("**/api/search/grouped?**", async (route) => {
      const reqUrl = route.request().url();
      groupedRequests.push(reqUrl);
      const url = new URL(reqUrl);
      const pageParam = Number(url.searchParams.get("page") ?? "1");
      const pageSizeParam = Number(url.searchParams.get("pageSize") ?? "20");

      const episodeId = pageParam === 1 ? "ep-1" : "ep-2";
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          feeds: [
            {
              feedId: "feed-1",
              feedTitle: "Feed",
              feedMode: "full",
              mentionCount: 1,
              episodes: [
                {
                  episodeId,
                  episodeTitle: `Episode ${pageParam}`,
                  audioUrl: "https://example.com/audio.mp3",
                  audioLocalPath: null,
                  episodeUrl: null,
                  mentionCount: 1,
                  bestRank: 1,
                },
              ],
            },
          ],
          totalFeeds: 1,
          totalEpisodes: 40,
          totalMentions: 40,
          coverage: { processed: 40, total: 40 },
          _debug: { pageParam, pageSizeParam },
        }),
      });
    });

    await page.goto("/search");
    await page.getByRole("textbox").fill("trade");
    await page.keyboard.press("Enter");

    await page.getByRole("button", { name: /grouped/i }).click();
    await expect(page.getByText(/Page 1 of 2/)).toBeVisible();
    await page.getByRole("button", { name: "Next →" }).click();
    await expect(page.getByText(/Page 2 of 2/)).toBeVisible();

    await page.locator("select").selectOption("50");
    await expect.poll(
      () => groupedRequests.some((u) => u.includes("pageSize=50"))
    ).toBeTruthy();
    await expect(page.getByRole("button", { name: "Next →" })).toHaveCount(0);
    expect(groupedRequests.some((u) => u.includes("pageSize=50"))).toBeTruthy();
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
