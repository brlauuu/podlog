import { NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

/** Map job_queue.task to the display status shown in the UI. */
const TASK_TO_STATUS: Record<string, string> = {
  download: "downloading",
  transcribe: "transcribing",
  diarize: "diarizing",
  embed: "embedding",
  infer: "inferring",
  archive: "archiving",
};

export async function GET() {
  try {
    // Active: episodes with a picked job in job_queue (source of truth)
    const activeQuery = pool.query(`
      SELECT DISTINCT ON (e.id)
        e.id        AS episode_id,
        e.title,
        jq.task     AS active_task,
        e.error_message,
        e.error_class,
        e.retry_count,
        e.retry_max,
        e.updated_at,
        jq.picked_at,
        f.mode      AS feed_mode,
        f.title     AS feed_title
      FROM job_queue jq
      JOIN episodes e ON e.id = jq.episode_id
      LEFT JOIN feeds f ON f.id = e.feed_id
      WHERE jq.status = 'picked'
      ORDER BY e.id, jq.picked_at DESC
    `);

    // Pending: episodes with pending jobs but no picked job
    const pendingQuery = pool.query(`
      SELECT DISTINCT ON (e.id)
        e.id        AS episode_id,
        e.title,
        jq.task     AS pending_task,
        e.error_message,
        e.error_class,
        e.retry_count,
        e.retry_max,
        e.updated_at,
        f.mode      AS feed_mode,
        f.title     AS feed_title
      FROM job_queue jq
      JOIN episodes e ON e.id = jq.episode_id
      LEFT JOIN feeds f ON f.id = e.feed_id
      WHERE jq.status = 'pending'
        AND NOT EXISTS (
          SELECT 1 FROM job_queue jq2
          WHERE jq2.episode_id = e.id AND jq2.status = 'picked'
        )
      ORDER BY e.id, jq.created_at ASC
    `);

    // Failed episodes (error details live on episodes table)
    const failedQuery = pool.query(`
      SELECT
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
      WHERE e.status = 'failed'
      ORDER BY e.updated_at DESC
    `);

    // Done episodes (limited to 50 + total count)
    const doneQuery = pool.query(`
      SELECT
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
      LIMIT 50
    `);

    const doneCountQuery = pool.query(
      `SELECT COUNT(*) AS count FROM episodes WHERE status = 'done'`
    );

    // Stuck: episodes not done/failed, with no pending or picked jobs in job_queue
    // (catches downloading:100 and other invalid status states)
    const stuckQuery = pool.query(`
      SELECT
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
      WHERE e.status NOT IN ('done', 'failed')
        AND NOT EXISTS (
          SELECT 1 FROM job_queue jq
          WHERE jq.episode_id = e.id AND jq.status IN ('pending', 'picked')
        )
      ORDER BY e.updated_at DESC
    `);

    const [activeResult, pendingResult, failedResult, doneResult, doneCountResult, stuckResult] =
      await Promise.all([activeQuery, pendingQuery, failedQuery, doneQuery, doneCountQuery, stuckQuery]);

    // Map task names to display statuses for active/pending jobs
    const activeJobs = activeResult.rows.map((r: Record<string, unknown>) => ({
      ...r,
      status: TASK_TO_STATUS[r.active_task as string] ?? r.active_task,
    }));

    const pendingJobs = pendingResult.rows.map((r: Record<string, unknown>) => ({
      ...r,
      status: "pending",
    }));

    const stuckJobs = stuckResult.rows.map((r: Record<string, unknown>) => ({
      ...r,
      status: "stuck",
    }));

    return NextResponse.json({
      active_count: activeJobs.length,
      pending_count: pendingJobs.length,
      failed_count: failedResult.rows.length,
      done_count: parseInt(doneCountResult.rows[0].count, 10),
      stuck_count: stuckJobs.length,
      active_jobs: activeJobs,
      pending_jobs: pendingJobs,
      failed_jobs: failedResult.rows,
      done_jobs: doneResult.rows,
      stuck_jobs: stuckJobs,
    });
  } catch (err) {
    console.error("Queue fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 500 }
    );
  }
}
