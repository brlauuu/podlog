import { NextResponse } from "next/server";
import pool from "@/lib/db";

const ACTIVE_STATUSES = [
  "downloading",
  "transcribing",
  "diarizing",
  "inferring",
  "archiving",
];

export async function GET() {
  try {
    // Fetch active, pending, and failed episodes in one query
    const { rows: jobs } = await pool.query(
      `SELECT
         e.id        AS episode_id,
         e.title,
         e.status,
         e.error_message,
         e.error_class,
         e.retry_count,
         e.retry_max,
         e.updated_at,
         f.mode      AS feed_mode,
         f.title     AS feed_title
       FROM episodes e
       LEFT JOIN feeds f ON f.id = e.feed_id
       WHERE e.status != 'done'
       ORDER BY e.updated_at DESC`
    );

    // Fetch done episodes (limited to 50, plus total count)
    const [doneResult, doneCountResult] = await Promise.all([
      pool.query(
        `SELECT
           e.id        AS episode_id,
           e.title,
           e.status,
           e.error_message,
           e.error_class,
           e.retry_count,
           e.retry_max,
           e.updated_at,
           f.mode      AS feed_mode,
           f.title     AS feed_title
         FROM episodes e
         LEFT JOIN feeds f ON f.id = e.feed_id
         WHERE e.status = 'done'
         ORDER BY e.updated_at DESC
         LIMIT 50`
      ),
      pool.query(
        `SELECT COUNT(*) AS count FROM episodes WHERE status = 'done'`
      ),
    ]);

    const activeJobs = jobs.filter((j: Record<string, unknown>) =>
      ACTIVE_STATUSES.includes(j.status as string)
    );
    const pendingJobs = jobs.filter(
      (j: Record<string, unknown>) => j.status === "pending"
    );
    const failedJobs = jobs.filter(
      (j: Record<string, unknown>) => j.status === "failed"
    );

    return NextResponse.json({
      active_count: activeJobs.length,
      pending_count: pendingJobs.length,
      failed_count: failedJobs.length,
      done_count: parseInt(doneCountResult.rows[0].count, 10),
      active_jobs: activeJobs,
      pending_jobs: pendingJobs,
      failed_jobs: failedJobs,
      done_jobs: doneResult.rows,
    });
  } catch (err) {
    console.error("Queue fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 500 }
    );
  }
}
