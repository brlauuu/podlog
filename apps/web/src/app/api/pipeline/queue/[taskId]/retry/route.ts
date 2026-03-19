import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST(req: NextRequest, { params }: { params: { taskId: string } }) {
  const resp = await fetch(`${PIPELINE_API}/api/queue/${params.taskId}/retry`, {
    method: "POST",
  });
  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
