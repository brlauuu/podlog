import { test, expect } from "@playwright/test";

/**
 * E2E tests for search flow — PRD-02 §13
 * Requires a running Podlog instance with seeded test data.
 */

test.describe("Search", () => {
  test("typing a query returns results", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Search transcripts...").fill("machine learning");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/results/i)).toBeVisible({ timeout: 5000 });
  });

  test("empty state shown when no results", async ({ page }) => {
    await page.goto("/");
    await page.getByPlaceholder("Search transcripts...").fill("xyzzy_no_match_42");
    await page.keyboard.press("Enter");
    await expect(page.getByText(/No results/i)).toBeVisible({ timeout: 5000 });
  });
});

test.describe("Dark mode", () => {
  test("toggle switches theme and persists on reload", async ({ page }) => {
    await page.goto("/");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: /dark|light mode/i });

    await toggle.click();
    await expect(html).toHaveClass(/dark/);

    await page.reload();
    await expect(html).toHaveClass(/dark/);
  });
});

test.describe("Audio player", () => {
  test("player persists across page navigation", async ({ page }) => {
    // This test requires a seeded episode with a local audio file
    test.skip(); // Implement with seeded test data
  });
});
