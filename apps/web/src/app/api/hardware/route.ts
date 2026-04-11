import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

export async function GET() {
  const resp = await fetch(`${PIPELINE_API}/api/hardware`, { cache: "no-store" });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
