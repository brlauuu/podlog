import { NextRequest } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

/**
 * POST /api/pipeline/ask — SSE proxy to pipeline's /api/ask endpoint.
 * Streams the response directly to the client.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  const resp = await fetch(`${PIPELINE_API}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (!resp.ok || !resp.body) {
    return new Response("Pipeline API error", { status: resp.status });
  }

  return new Response(resp.body, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
