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
