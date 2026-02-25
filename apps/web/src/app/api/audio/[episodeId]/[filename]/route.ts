import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";

const AUDIO_ARCHIVE_DIR = "/data/audio/archive";

/**
 * Serve archived audio files with path traversal prevention — PRD-02 §5.2, §11
 *
 * Security:
 * - filename parameter is treated as basename only (path separators stripped)
 * - Resolved path is verified to start with AUDIO_ARCHIVE_DIR before serving
 * - Any path that escapes the archive directory returns HTTP 400
 */
export async function GET(
  req: NextRequest,
  { params }: { params: { episodeId: string; filename: string } }
) {
  // Strip any path separators — treat filename as basename only
  const safeName = path.basename(params.filename);
  const resolved = path.resolve(AUDIO_ARCHIVE_DIR, safeName);

  // Verify resolved path stays within archive directory
  if (!resolved.startsWith(AUDIO_ARCHIVE_DIR + path.sep)) {
    return new NextResponse("Invalid path", { status: 400 });
  }

  if (!fs.existsSync(resolved)) {
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
