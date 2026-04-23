import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/meta-analysis/snapshot`, {
      cache: "no-store",
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("meta-analysis snapshot proxy failed:", err);
    return NextResponse.json(
      { error: "Pipeline unreachable" },
      { status: 502 }
    );
  }
}
