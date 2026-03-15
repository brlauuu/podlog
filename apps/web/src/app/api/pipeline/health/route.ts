import { NextResponse } from "next/server";

const PIPELINE_API = process.env.PIPELINE_API_URL ?? "http://pipeline:8000";

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
        { name: "Redis", status: "DEGRADED" },
        { name: "Worker", status: "DEGRADED" },
      ],
    });
  }
}
