import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const resp = await fetch(
    `${PIPELINE_API}/api/prompts/${encodeURIComponent(key)}/reset`,
    { method: "POST" }
  );
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
