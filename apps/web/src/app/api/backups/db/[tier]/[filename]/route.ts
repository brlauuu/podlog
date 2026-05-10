import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ tier: string; filename: string }> },
) {
  const { tier, filename } = await params;
  const resp = await fetch(
    `${PIPELINE_API}/api/backups/db/${encodeURIComponent(tier)}/${encodeURIComponent(filename)}`,
    { method: "DELETE" },
  );
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
