import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ date: string }> },
) {
  const { date } = await params;
  const resp = await fetch(
    `${PIPELINE_API}/api/backups/audio/${encodeURIComponent(date)}`,
    { method: "DELETE" },
  );
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
