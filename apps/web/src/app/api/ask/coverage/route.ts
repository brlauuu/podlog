import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const result = await pool.query(`
    SELECT
      COUNT(*) FILTER (WHERE status = 'done') AS processed,
      COUNT(*) AS total,
      EXISTS(SELECT 1 FROM episodes WHERE feed_id IS NULL) AS has_manual_uploads
    FROM episodes
  `);

  const row = result.rows[0];
  return NextResponse.json({
    processed: Number(row.processed),
    total: Number(row.total),
    has_manual_uploads: row.has_manual_uploads,
  });
}
