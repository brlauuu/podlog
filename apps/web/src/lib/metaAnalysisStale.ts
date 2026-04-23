import pool from "@/lib/db";

/**
 * Set the meta_analysis_stale flag to true so the pipeline worker's
 * idle hook recomputes the dashboard snapshot on next drain. (Issue #521)
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
      ["meta_analysis_stale", "true"]
    );
  } catch (err) {
    console.error("setMetaAnalysisStale failed:", err);
  }
}
