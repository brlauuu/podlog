import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * GET /api/queue/recent — episodes finished or failed in the last 7 days,
 * for the home-page roller (#1079). A thin proxy like /api/queue: the read
 * lives in the pipeline, which owns the job_queue schema (#555).
 */
export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/queue/recent?days=7`, {
      cache: "no-store",
    });
    const text = await resp.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : [];
    } catch {
      return NextResponse.json(
        { error: `Upstream returned non-JSON (status ${resp.status})` },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("Recent activity fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch recent activity" },
      { status: 502 }
    );
  }
}
