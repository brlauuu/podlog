import { randomUUID } from "crypto";
import pool from "@/lib/db";

/**
 * Mark the meta-analysis snapshot stale so the pipeline worker's idle hook
 * recomputes it on next drain. (Issue #521)
 *
 * Writes a fresh UUID token — mirrors `set_stale` in
 * apps/pipeline/app/services/meta_analysis.py. The token enables
 * recompute_and_store to detect concurrent set_stale calls during compute
 * and avoid silently dropping the signal. Any value other than "false"
 * (including a UUID) is "stale"; "false" or missing row is "not stale".
 *
 * Swallows errors — a failure here should never break the speaker-rename
 * path; worst case the dashboard is slightly stale until another trigger.
 */
export async function setMetaAnalysisStale(): Promise<void> {
  try {
    await pool.query(
      `INSERT INTO system_state (key, value)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      ["meta_analysis_stale", randomUUID()]
    );
  } catch (err) {
    console.error("setMetaAnalysisStale failed:", err);
  }
}
