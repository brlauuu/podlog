import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/**
 * GET /api/search/speakers — list distinct confirmed speaker names across selected feeds.
 * Used to populate the speaker filter dropdown on the search page.
 *
 * Query params:
 *   feedId  — comma-separated feed UUIDs (optional)
 *   uploads — "true" to include manual uploads
 *
 * Returns: [{ speaker_label, display_name }] ordered by display_name.
 * `speaker_label` is intentionally set to display_name for compatibility with existing clients.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;
  const feedIdRaw = searchParams.get("feedId") || null;
  const feedIds = feedIdRaw ? feedIdRaw.split(",").filter(Boolean) : null;
  const includeManualUploads = searchParams.get("uploads") === "true";

  const hasFeedIds = feedIds && feedIds.length > 0;
  const feedClause =
    !hasFeedIds && !includeManualUploads
      ? "TRUE"
      : (() => {
          const parts: string[] = [];
          if (hasFeedIds) parts.push("f.id = ANY($1::uuid[])");
          if (includeManualUploads) parts.push("e.feed_id IS NULL");
          return `(${parts.join(" OR ")})`;
        })();

  const params: unknown[] = hasFeedIds ? [feedIds] : [];

  try {
    const result = await pool.query(
      `SELECT DISTINCT
        BTRIM(sn.display_name) AS display_name
      FROM speaker_names sn
      JOIN episodes e ON sn.episode_id = e.id
      LEFT JOIN feeds f ON e.feed_id = f.id
      WHERE sn.confirmed_by_user = true
        AND NULLIF(BTRIM(sn.display_name), '') IS NOT NULL
        AND e.status = 'done'
        AND ${feedClause}
      ORDER BY display_name`,
      params
    );

    return NextResponse.json(
      result.rows.map((row: { display_name: string }) => ({
        speaker_label: row.display_name,
        display_name: row.display_name,
      }))
    );
  } catch (err) {
    console.error("Speakers fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch speakers" }, { status: 500 });
  }
}
