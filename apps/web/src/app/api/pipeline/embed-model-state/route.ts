import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

/**
 * Proxies the embedding-provenance record (#945) so the Settings UI can show
 * which model actually built the corpus next to the model being configured.
 */
export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/embed/model-state`, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!resp.ok) {
      return NextResponse.json({ error: "Unavailable" }, { status: 502 });
    }
    return NextResponse.json(await resp.json());
  } catch {
    // The pipeline being down must not break the Settings page.
    return NextResponse.json({ error: "Unavailable" }, { status: 502 });
  }
}
