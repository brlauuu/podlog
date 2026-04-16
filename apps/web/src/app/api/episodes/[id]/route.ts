import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const resp = await fetch(`${PIPELINE_API}/api/episodes/${id}`, { method: "DELETE" });
  if (resp.status === 204) return new NextResponse(null, { status: 204 });
  const text = await resp.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = { detail: text || "Pipeline API returned a non-JSON error" };
  }
  return NextResponse.json(data, { status: resp.status });
}
