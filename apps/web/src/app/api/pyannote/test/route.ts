import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

/**
 * Proxies the pyannote-cloud key check (#933). Mirrors the notifications/test
 * route. The pipeline reads the destination base URL from its own settings, so
 * only the key itself travels in the body.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();
  const resp = await fetch(`${PIPELINE_API}/api/pyannote/test`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
