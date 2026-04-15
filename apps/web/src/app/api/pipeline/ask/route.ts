import { NextRequest } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

/**
 * POST /api/pipeline/ask — SSE proxy to pipeline's /api/ask endpoint.
 *
 * Pipes the upstream stream through a ReadableStream we control so that
 * client disconnects (abort, navigate away, resubmit) cleanly close the
 * upstream fetch instead of crashing the route with
 * `TypeError: Invalid state: Controller is already closed`.
 */
export async function POST(req: NextRequest) {
  const body = await req.json();

  const upstreamAbort = new AbortController();
  req.signal.addEventListener("abort", () => upstreamAbort.abort(), {
    once: true,
  });

  const resp = await fetch(`${PIPELINE_API}/api/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: upstreamAbort.signal,
  });

  if (!resp.ok || !resp.body) {
    return new Response("Pipeline API error", { status: resp.status });
  }

  const upstream = resp.body;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const reader = upstream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          controller.enqueue(value);
        }
        controller.close();
      } catch {
        // Client disconnected or upstream errored. Nothing to do —
        // cancel() will run and abort the upstream fetch.
      }
    },
    cancel() {
      upstreamAbort.abort();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
}
