import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

const PIPELINE_API = process.env.PIPELINE_API_URL ?? "http://pipeline:8000";

export async function GET() {
  try {
    const result = await pool.query(`
      SELECT f.id, f.url, f.title, f.mode, f.last_polled_at,
             COUNT(e.id)::int AS episode_count
      FROM feeds f
      LEFT JOIN episodes e ON e.feed_id = f.id
      GROUP BY f.id
      ORDER BY f.created_at DESC
    `);
    return NextResponse.json(result.rows);
  } catch (err) {
    console.error("Feeds list error:", err);
    return NextResponse.json({ error: "Failed to load feeds" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    // Proxy to pipeline API which handles validation and ingestion
    const resp = await fetch(`${PIPELINE_API}/api/feeds`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text || "Pipeline API returned a non-JSON error" };
    }
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("Add feed error:", err);
    return NextResponse.json({ error: "Failed to add feed" }, { status: 500 });
  }
}
