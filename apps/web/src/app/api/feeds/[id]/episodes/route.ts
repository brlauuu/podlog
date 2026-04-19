import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const body = await req.json();
    const resp = await fetch(`${PIPELINE_API}/api/feeds/${id}/episodes`, {
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
    console.error("Add feed episodes error:", err);
    return NextResponse.json(
      { error: "Failed to add episodes" },
      { status: 500 },
    );
  }
}
