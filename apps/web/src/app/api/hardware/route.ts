import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export const dynamic = "force-dynamic";

const FALLBACK = {
  hardware: null,
  profile: null,
  profile_label: null,
  estimates: {
    transcription_minutes_per_hour: null,
    embedding_seconds_per_hour: null,
    remote_transcription_minutes_per_hour: 3,
    remote_embedding_seconds_per_hour: 5,
    remote_cost_per_hour_usd: 0.36,
  },
};

export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/hardware`, { cache: "no-store" });
    if (!resp.ok) {
      return NextResponse.json(FALLBACK, { status: resp.status });
    }
    const data = await resp.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json(FALLBACK, { status: 502 });
  }
}
