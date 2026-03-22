import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

// Issue #84: proxy feed preview requests to the pipeline API.
// No DB writes — pipeline fetches the RSS URL and returns feed metadata + episode list.
export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url query parameter is required" }, { status: 400 });
  }

  try {
    const resp = await fetch(
      `${PIPELINE_API}/api/feeds/preview?url=${encodeURIComponent(url)}`,
    );
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text || "Pipeline API returned a non-JSON error" };
    }
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("Feed preview error:", err);
    return NextResponse.json({ error: "Failed to fetch feed preview" }, { status: 500 });
  }
}
