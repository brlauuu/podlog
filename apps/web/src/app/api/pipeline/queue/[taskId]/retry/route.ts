import { NextRequest, NextResponse } from "next/server";

const PIPELINE_API = process.env.PIPELINE_API_URL ?? "http://pipeline:8000";

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  const resp = await fetch(`${PIPELINE_API}/api/queue/${params.taskId}/retry`, {
    method: "POST",
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
