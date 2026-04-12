import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export async function GET(
  req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;
  const filename = slug + ".md";
  const docsDir = join(process.cwd(), "docs", "guide");

  try {
    const filePath = join(docsDir, filename);
    const content = await readFile(filePath, "utf-8");
    return new NextResponse(content, {
      headers: { "Content-Type": "text/markdown" },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
