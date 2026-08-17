import { PIPELINE_API } from "@/lib/pipeline";

/**
 * Query-embedding lookup for hybrid search.
 *
 * Returning `null` is a supported outcome, not an error: `searchSegmentsHybrid`
 * drops the vector arm and serves FTS-only results. The web app reads Postgres
 * directly for keyword search, so an unavailable pipeline must never take down
 * the half of search that has no dependency on it.
 *
 * Two guards keep that degradation fast (#928):
 *
 *  - A bounded fetch. An unresolvable `pipeline` host makes `fetch` sit in DNS
 *    retry for ~24s rather than failing, long enough for requests to pile up
 *    and exhaust the `pg` pool (max 10) behind them.
 *  - A cooldown. Without it every request still pays the full timeout while the
 *    pipeline is down, which only slows the pile-up instead of stopping it.
 */

const DEFAULT_TIMEOUT_MS = 2000;
const DEFAULT_COOLDOWN_MS = 30000;

function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/**
 * Epoch ms until which the fetch is skipped outright. Module-level state,
 * matching the shared-singleton pattern in `@/lib/db`.
 */
let cooldownUntil = 0;

/** Test hook — clears the cooldown so cases don't leak into one another. */
export function resetEmbeddingCooldown(): void {
  cooldownUntil = 0;
}

export async function getQueryEmbedding(text: string): Promise<number[] | null> {
  if (Date.now() < cooldownUntil) return null;

  try {
    const resp = await fetch(`${PIPELINE_API}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(envInt("EMBED_TIMEOUT_MS", DEFAULT_TIMEOUT_MS)),
    });
    if (!resp.ok) {
      cooldownUntil = Date.now() + envInt("EMBED_COOLDOWN_MS", DEFAULT_COOLDOWN_MS);
      return null;
    }
    const data = await resp.json();
    cooldownUntil = 0;
    return data.embedding;
  } catch {
    // Covers the abort, DNS/connection failures, and a malformed JSON body.
    cooldownUntil = Date.now() + envInt("EMBED_COOLDOWN_MS", DEFAULT_COOLDOWN_MS);
    return null;
  }
}
