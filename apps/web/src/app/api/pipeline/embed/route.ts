import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const resp = await fetch(`${PIPELINE_API}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!resp.ok) {
      return NextResponse.json(
        { error: "Embedding failed" },
        { status: resp.status }
      );
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Embed proxy error:", err);
    return NextResponse.json(
      { error: "Embedding service unavailable" },
      { status: 503 }
    );
  }
}
