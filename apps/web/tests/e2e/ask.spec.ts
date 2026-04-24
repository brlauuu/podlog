import { test, expect } from "@playwright/test";
import type { Pool } from "pg";
import { getFixturePool, seedEpisode, type SeededEpisode } from "./fixtures/db";

/**
 * Browser E2E for the Ask-AI chat overlay on an episode page (#567).
 *
 * EpisodeChat fetches /api/pipeline/ask and consumes an SSE stream. We
 * stub the proxy with a full SSE body; Playwright's real `fetch` +
 * `ReadableStream` implementation drives the component's reader loop
 * end-to-end (which jsdom can't do — see #573 for the jest attempt).
 *
 * The /episodes/[id] page is a server component that reads the episode
 * row via `pool.query`, so we seed a disposable episode in the DB
 * before the tests and clean it up after.
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
    title: "E2E Ask target",
    withSegments: true,
  });
});

test.afterAll(async () => {
  if (seeded) await seeded.cleanup();
  if (pool) await pool.end();
});

function sseBody(events: Array<[string, unknown]>): string {
  return (
    events
      .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}`)
      .join("\n\n") + "\n\n"
  );
}

test.describe("Ask AI (EpisodeChat)", () => {
  test("streams token + sources + done events into an assistant message", async ({
    page,
  }) => {
    await page.route("**/api/pipeline/ask", async (route) => {
      const body = sseBody([
        ["token", { content: "The guest said " }],
        ["token", { content: "hello." }],
        [
          "sources",
          [
            {
              chunk_id: 1,
              episode_id: seeded!.episodeId,
              episode_title: "E2E Ask target",
              speaker_label: "SPEAKER_00",
              start_time: 5.0,
              end_time: 9.0,
              timestamp: "00:05",
              text: "The relevant passage for the citation.",
              similarity: 0.91,
            },
          ],
        ],
        ["done", {}],
      ]);
      await route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body,
      });
    });

    await page.goto(`/episodes/${seeded!.episodeId}`);

    await page
      .getByRole("button", { name: /ask about this episode/i })
      .click();

    const input = page.getByPlaceholder(/ask about this episode\.\.\./i);
    await input.fill("what did the guest say?");
    await input.press("Enter");

    await expect(
      page.getByText(/The guest said\s+hello\./)
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /relevant passage/i })
    ).toBeVisible();
  });

  test("surfaces a connection banner when the proxy is unreachable", async ({
    page,
  }) => {
    await page.route("**/api/pipeline/ask", async (route) => {
      await route.abort("failed");
    });

    await page.goto(`/episodes/${seeded!.episodeId}`);

    await page
      .getByRole("button", { name: /ask about this episode/i })
      .click();

    const input = page.getByPlaceholder(/ask about this episode\.\.\./i);
    await input.fill("hello");
    await input.press("Enter");

    await expect(
      page.getByText(/Connection failed/i)
    ).toBeVisible();
  });
});
