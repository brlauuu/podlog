import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  const resp = await fetch(`${PIPELINE_API}/api/backups/retention`, {
    cache: "no-store",
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}

export async function PUT(req: NextRequest) {
  const body = await req.json();
  const resp = await fetch(`${PIPELINE_API}/api/backups/retention`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
