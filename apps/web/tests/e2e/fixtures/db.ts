/**
 * DB fixture helpers for Playwright e2e specs that target SSR pages.
 *
 * The /episodes/[id] route and other server components read directly
 * from Postgres via `pool.query` — they can't be stubbed with
 * `page.route`. These helpers insert a minimal feed + episode row (and
 * optionally a couple of segments) so specs can navigate to a known
 * URL, then delete what they inserted.
 *
 * DATABASE_URL resolution:
 *   - CI (docker-compose.test.yml `web_test` service): DATABASE_URL is
 *     set to the disposable `db_test` instance.
 *   - Local: set DATABASE_URL when running e2e, e.g.
 *       DATABASE_URL="postgresql://postgres:$POSTGRES_PASSWORD@localhost:5432/podlog" \
 *         npm run test:e2e
 *     If DATABASE_URL is unset, `getFixturePool()` returns null and
 *     specs that need a DB should `test.skip()` with a clear message.
 */
import { randomUUID } from "node:crypto";
import { Pool } from "pg";

export interface SeededEpisode {
  feedId: string;
  episodeId: string;
  cleanup: () => Promise<void>;
}

export function getFixturePool(): Pool | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return new Pool({ connectionString: url, max: 2 });
}

export interface SeedEpisodeOpts {
  title?: string;
  description?: string;
  feedTitle?: string;
  withSegments?: boolean;
}

export async function seedEpisode(
  pool: Pool,
  opts: SeedEpisodeOpts = {}
): Promise<SeededEpisode> {
  const feedId = randomUUID();
  const episodeId = randomUUID();
  const feedTitle = opts.feedTitle ?? `E2E Feed ${feedId.slice(0, 8)}`;
  const title = opts.title ?? `E2E Episode ${episodeId.slice(0, 8)}`;
  const description = opts.description ?? "Seeded by Playwright e2e.";

  await pool.query(
    `INSERT INTO feeds (id, url, title, mode) VALUES ($1, $2, $3, 'full')`,
    [feedId, `https://e2e.podlog.test/${feedId}/feed.xml`, feedTitle]
  );
  await pool.query(
    `INSERT INTO episodes (
       id, feed_id, title, description, audio_url, guid,
       status, has_diarization
     ) VALUES ($1, $2, $3, $4, $5, $6, 'done', true)`,
    [
      episodeId,
      feedId,
      title,
      description,
      `https://e2e.podlog.test/${episodeId}.mp3`,
      episodeId,
    ]
  );

  if (opts.withSegments) {
    await pool.query(
      `INSERT INTO segments (episode_id, speaker_label, start_time, end_time, text)
       VALUES ($1, 'SPEAKER_00', 0, 10, 'Hello and welcome to the show.'),
              ($1, 'SPEAKER_01', 10, 20, 'Thanks for having me on.')`,
      [episodeId]
    );
  }

  async function cleanup() {
    // Order matters: segments FK -> episodes FK -> feeds.
    await pool.query("DELETE FROM segments WHERE episode_id = $1", [episodeId]);
    await pool.query("DELETE FROM speaker_names WHERE episode_id = $1", [
      episodeId,
    ]);
    await pool.query("DELETE FROM episodes WHERE id = $1", [episodeId]);
    await pool.query("DELETE FROM feeds WHERE id = $1", [feedId]);
  }

  return { feedId, episodeId, cleanup };
}
