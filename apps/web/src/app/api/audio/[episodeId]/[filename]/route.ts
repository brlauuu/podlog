import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const AUDIO_DIRS = ["/data/audio/archive", "/data/audio/raw"];

/**
 * Serve audio files with path traversal prevention — PRD-02 §5.2, §11
 *
 * Checks archive first, then raw (for episodes not yet archived).
 *
 * Security:
 * - filename parameter is treated as basename only (path separators stripped)
 * - Resolved path is verified to stay within allowed directories
 * - Any path that escapes the audio directories returns HTTP 400
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { episodeId: string; filename: string } }
) {
  // Strip any path separators — treat filename as basename only
  const safeName = path.basename(params.filename);

  // Find the file in archive or raw directories
  let resolved: string | null = null;
  for (const dir of AUDIO_DIRS) {
    const candidate = path.resolve(dir, safeName);
    if (!candidate.startsWith(dir + path.sep)) continue;
    if (fs.existsSync(candidate)) {
      resolved = candidate;
      break;
    }
  }

  if (!resolved) {
    return new NextResponse("Not found", { status: 404 });
  }

  const stat = fs.statSync(resolved);
  const fileSize = stat.size;
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
    // Support range requests for seeking (HTML5 audio requires this)
    const [startStr, endStr] = rangeHeader.replace(/bytes=/, "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    const stream = fs.createReadStream(resolved, { start, end });
    const readableStream = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(chunk));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new NextResponse(readableStream, {
      status: 206,
      headers: {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": String(chunkSize),
        "Content-Type": "audio/mpeg",
      },
    });
  }

  const stream = fs.createReadStream(resolved);
  const readableStream = new ReadableStream({
    start(controller) {
      stream.on("data", (chunk) => controller.enqueue(chunk));
      stream.on("end", () => controller.close());
      stream.on("error", (err) => controller.error(err));
    },
  });

  return new NextResponse(readableStream, {
    headers: {
      "Content-Length": String(fileSize),
      "Content-Type": "audio/mpeg",
      "Accept-Ranges": "bytes",
    },
  });
}
