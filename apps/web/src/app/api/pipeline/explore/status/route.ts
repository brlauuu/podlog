import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  const resp = await fetch(`${PIPELINE_API}/api/explore/status`);
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
