import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  const resp = await fetch(
    `${PIPELINE_API}/api/queue/bulk-retry/upload-rejected`,
  );
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}

export async function POST() {
  const resp = await fetch(
    `${PIPELINE_API}/api/queue/bulk-retry/upload-rejected`,
    { method: "POST" },
  );
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
