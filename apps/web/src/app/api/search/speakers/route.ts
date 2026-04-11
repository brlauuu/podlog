import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

/**
 * GET /api/search/speakers — list distinct speakers across selected feeds.
 * Used to populate the speaker filter dropdown on the search page.
 *
 * Query params:
 *   feedId  — comma-separated feed UUIDs (optional)
 *   uploads — "true" to include manual uploads
 *
 * Returns: [{ speaker_label, display_name }] ordered by display_name.
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
      `SELECT DISTINCT ON (s.speaker_label)
        s.speaker_label,
        COALESCE(sn.display_name, s.speaker_label) AS display_name
      FROM segments s
      JOIN episodes e ON s.episode_id = e.id
      LEFT JOIN feeds f ON e.feed_id = f.id
      LEFT JOIN speaker_names sn ON sn.episode_id = s.episode_id AND sn.speaker_label = s.speaker_label
      WHERE s.speaker_label IS NOT NULL
        AND e.status = 'done'
        AND ${feedClause}
      ORDER BY s.speaker_label, display_name`,
      params
    );

    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("Speakers fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch speakers" }, { status: 500 });
  }
}
