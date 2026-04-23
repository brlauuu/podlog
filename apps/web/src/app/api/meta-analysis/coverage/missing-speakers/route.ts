import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  try {
    const resp = await fetch(
      `${PIPELINE_API}/api/meta-analysis/coverage/missing-speakers`,
      { cache: "no-store" }
    );
    const text = await resp.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Empty {podcasts:[]} on transient failure lets the dashboard render an empty CoverageStrip instead of an error state.
      return NextResponse.json({ podcasts: [] }, { status: 502 });
    }
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("missing-speakers proxy failed:", err);
    // Empty {podcasts:[]} on transient failure lets the dashboard render an empty CoverageStrip instead of an error state.
    return NextResponse.json({ podcasts: [] }, { status: 502 });
  }
}
