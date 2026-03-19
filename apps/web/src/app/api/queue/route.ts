import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/queue`, { cache: "no-store" });
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Queue fetch error:", err);
    return NextResponse.json({ error: "Failed to fetch queue" }, { status: 500 });
  }
}
