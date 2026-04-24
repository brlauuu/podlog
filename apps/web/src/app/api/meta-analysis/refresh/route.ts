import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/meta-analysis/refresh`, {
      method: "POST",
      cache: "no-store",
    });
    const text = await resp.text();
    let data: unknown;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      // Upstream returned non-JSON. Surface the upstream status with a textual hint.
      return NextResponse.json(
        { error: `Upstream returned non-JSON (status ${resp.status})` },
        { status: 502 }
      );
    }
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("meta-analysis refresh proxy failed:", err);
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 502 }
    );
  }
}
