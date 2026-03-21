import { NextRequest, NextResponse } from "next/server";
import { searchSegments } from "@/lib/search";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const feedId = searchParams.get("feedId") || null;
  const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10));
  const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10)));
  const skipCount = searchParams.get("skipCount") === "true";

  try {
    const result = await searchSegments(q, feedId, page, pageSize, skipCount);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
