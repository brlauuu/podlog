import { NextRequest, NextResponse } from "next/server";
import { PIPELINE_API } from "@/lib/pipeline";

export async function POST(req: NextRequest) {
  const formData = await req.formData();

  const resp = await fetch(`${PIPELINE_API}/api/episodes/upload`, {
    method: "POST",
    body: formData,
  });

  const data = await resp.json();
  return NextResponse.json(data, { status: resp.status });
}
