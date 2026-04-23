import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/meta-analysis/refresh`, {
      method: "POST",
      cache: "no-store",
    });
    const data = await resp.json();
    return NextResponse.json(data, { status: resp.status });
  } catch (err) {
    console.error("meta-analysis refresh proxy failed:", err);
    return NextResponse.json(
      { error: "Refresh failed" },
      { status: 502 }
    );
  }
}
