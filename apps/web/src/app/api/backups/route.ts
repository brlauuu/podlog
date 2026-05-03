import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const FALLBACK = {
  enabled: false,
  mounted: false,
  retention: { daily: 0, weekly: 0, monthly: 0 },
  last_run: null,
  db: { daily: [], weekly: [], monthly: [] },
  audio: [],
};

export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/backups`, { cache: "no-store" });
    if (!resp.ok) {
      return NextResponse.json(FALLBACK, { status: resp.status });
    }
    return NextResponse.json(await resp.json());
  } catch {
    return NextResponse.json(FALLBACK, { status: 502 });
  }
}
