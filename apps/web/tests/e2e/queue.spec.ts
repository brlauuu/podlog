import { test, expect } from "@playwright/test";

/**
 * Browser E2E smoke for the Queue dashboard (#567).
 *
 * The /queue page is a thin wrapper around <QueueStatus/>, which fetches
 * /api/queue (proxied through to the pipeline per #555). We stub the
 * proxy response so the test is runnable without a seeded backend.
 */

const BASE_PAYLOAD = {
  active_count: 0,
  pending_count: 0,
  failed_count: 0,
  done_count: 0,
  stuck_count: 0,
  active_jobs: [],
  pending_jobs: [],
  failed_jobs: [],
  done_jobs: [],
  stuck_jobs: [],
};

test.describe("Queue dashboard", () => {
  test("stage bar renders the six pipeline stages", async ({ page }) => {
    await page.route("**/api/queue", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(BASE_PAYLOAD),
      });
    });

    await page.goto("/queue");

    for (const label of [
      "Pending",
      "Downloading",
      "Transcribing",
      "Diarizing",
      "Inferring",
      "Archiving",
    ]) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
  });

  test("shows an active episode with its mapped display status", async ({ page }) => {
    await page.route("**/api/queue", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...BASE_PAYLOAD,
          active_count: 1,
          active_jobs: [
            {
              episode_id: "ep-active",
              title: "Active transcription",
              active_task: "transcribe",
              status: "transcribing",
              error_message: null,
              error_class: null,
              retry_count: 0,
              retry_max: 3,
              updated_at: new Date().toISOString(),
              picked_at: new Date().toISOString(),
              feed_mode: "full",
              feed_title: "Some Podcast",
            },
          ],
        }),
      });
    });

    await page.goto("/queue");

    await expect(page.getByText("Active transcription")).toBeVisible();
    await expect(page.getByText("TRANSCRIBING", { exact: true })).toBeVisible();
  });

  test("retry button on a failed episode hits the pipeline retry endpoint", async ({ page }) => {
    const retryCalls: string[] = [];

    await page.route("**/api/queue", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          ...BASE_PAYLOAD,
          failed_count: 1,
          failed_jobs: [
            {
              episode_id: "ep-fail",
              title: "Broken episode",
              status: "failed",
              error_message: "HTTP 404",
              error_class: "HTTP_ACCESS",
              retry_count: 3,
              retry_max: 3,
              updated_at: new Date().toISOString(),
              feed_mode: "full",
              feed_title: "Broken Feed",
            },
          ],
        }),
      });
    });

    await page.route("**/api/pipeline/queue/ep-fail/retry", async (route) => {
      retryCalls.push(route.request().url());
      await route.fulfill({
        status: 202,
        contentType: "application/json",
        body: JSON.stringify({ queued: true, episode_id: "ep-fail" }),
      });
    });

    await page.goto("/queue");

    // Expand the row. Every cell with an interactive child (title Link,
    // feed-title button, status button) calls stopPropagation, so we
    // click the retry-count cell (plain text) to let the tr handler fire.
    await page.getByText("3/3", { exact: true }).click();
    await page.getByRole("button", { name: /^retry$/i }).click();

    await expect.poll(() => retryCalls.length).toBeGreaterThan(0);
  });
});
