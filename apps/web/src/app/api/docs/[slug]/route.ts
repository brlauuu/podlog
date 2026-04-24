import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { join } from "path";

export const dynamic = "force-dynamic";

const SAFE_SLUG_REGEX = /^[a-zA-Z0-9_-]+$/;

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ slug: string }> }
) {
  const { slug } = await context.params;

  if (!SAFE_SLUG_REGEX.test(slug)) {
    return new NextResponse("Invalid slug", { status: 400 });
  }

  const filename = slug + ".md";
  const docsDir = join(process.cwd(), "..", "..", "docs", "guide");
  const filePath = join(docsDir, filename);

  if (!filePath.startsWith(docsDir)) {
    return new NextResponse("Invalid slug", { status: 400 });
  }

  try {
    const content = await readFile(filePath, "utf-8");
    return new NextResponse(content, {
      headers: { "Content-Type": "text/markdown" },
    });
  } catch (err) {
    console.error("Failed to read doc file:", slug, err);
    return new NextResponse("Not found", { status: 404 });
  }
}
