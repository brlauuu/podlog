import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * GET /api/queue — thin proxy to the pipeline FastAPI.
 *
 * Queue reads used to run raw SQL against job_queue from the web app.
 * Ownership lives in the pipeline now (#555) so the web and the
 * pipeline don't silently drift on schema changes. Web just forwards.
 */
export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/queue`, { cache: "no-store" });
    const text = await resp.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      return NextResponse.json(
        { error: `Upstream returned non-JSON (status ${resp.status})` },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("Queue fetch error:", err);
    return NextResponse.json(
      { error: "Failed to fetch queue" },
      { status: 502 }
    );
  }
}
