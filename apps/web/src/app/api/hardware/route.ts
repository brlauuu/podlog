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
