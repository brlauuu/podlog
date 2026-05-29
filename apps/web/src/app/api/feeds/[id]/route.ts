import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const deleteEpisodes = req.nextUrl.searchParams.get("delete_episodes") === "true";
  const resp = await fetch(
    `${PIPELINE_API}/api/feeds/${id}?delete_episodes=${deleteEpisodes}`,
    { method: "DELETE" }
  );
  if (resp.status === 204) return new NextResponse(null, { status: 204 });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}

// Issue #743: forwards { paused: boolean } to PATCH /api/feeds/{id} on
// the pipeline. Used by the FeedCard pause/resume button.
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const resp = await fetch(`${PIPELINE_API}/api/feeds/${id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
