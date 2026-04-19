import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  try {
    const resp = await fetch(`${PIPELINE_API}/api/feeds/${id}/episodes/guids`);
    const text = await resp.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = { detail: text || "Pipeline API returned a non-JSON error" };
    }
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("Feed episode GUIDs error:", err);
    return NextResponse.json(
      { error: "Failed to load feed episodes" },
      { status: 500 },
    );
  }
}
