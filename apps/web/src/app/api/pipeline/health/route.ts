import { NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function GET() {
  try {
    const resp = await fetch(`${PIPELINE_API}/api/health`, { cache: "no-store" });
    const data = await resp.json();
    return NextResponse.json(data);
  } catch {
    return NextResponse.json({
      status: "DEGRADED",
      services: [
        { name: "Pipeline API", status: "DEGRADED" },
        { name: "Database", status: "DEGRADED" },
        { name: "Worker", status: "DEGRADED" },
      ],
    });
  }
}
