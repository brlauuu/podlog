import { NextRequest, NextResponse } from "next/server";

const PIPELINE_API = process.env.PIPELINE_API_URL ?? "http://pipeline:8000";

export async function DELETE(req: NextRequest, { params }: { params: { id: string } }) {
  const deleteEpisodes = req.nextUrl.searchParams.get("delete_episodes") === "true";
  const resp = await fetch(
    `${PIPELINE_API}/api/feeds/${params.id}?delete_episodes=${deleteEpisodes}`,
    { method: "DELETE" }
  );
  if (resp.status === 204) return new NextResponse(null, { status: 204 });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
