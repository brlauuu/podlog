import { NextRequest, NextResponse } from "next/server";
import { searchMentions } from "@/lib/search";

export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl;

  const q = searchParams.get("q")?.trim();
  if (!q) {
    return NextResponse.json({ error: "q is required" }, { status: 400 });
  }

  const episodeId = searchParams.get("episodeId")?.trim();
  if (!episodeId) {
    return NextResponse.json({ error: "episodeId is required" }, { status: 400 });
  }

  try {
    const result = await searchMentions(q, episodeId);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Mentions search error:", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
