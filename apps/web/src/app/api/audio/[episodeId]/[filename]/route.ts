import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import pool from "@/lib/db";

const AUDIO_DIRS = ["/data/audio/archive", "/data/audio/raw"];

const MIME_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".mp4": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".flac": "audio/flac",
  ".opus": "audio/opus",
  ".aac": "audio/aac",
  ".wma": "audio/x-ms-wma",
};

function getContentType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  return MIME_TYPES[ext] ?? "audio/mpeg";
}

/**
 * Serve audio files with path traversal prevention — PRD-02 §5.2, §11
 *
 * Checks archive first, then raw (for episodes not yet archived).
 *
 * Security:
 * - filename parameter is treated as basename only (path separators stripped)
 * - Resolved path is verified to stay within allowed directories
 * - episodeId is validated against the database
 * - Any path that escapes the audio directories returns HTTP 400
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ episodeId: string; filename: string }> }
) {
  const { episodeId, filename } = await params;

  // Validate episode exists and the file belongs to it
  const epResult = await pool.query(
    "SELECT audio_local_path FROM episodes WHERE id = $1",
    [episodeId]
  );
  if (epResult.rows.length === 0) {
    return new NextResponse("Episode not found", { status: 404 });
  }

  // Strip any path separators — treat filename as basename only
  const safeName = path.basename(filename);

  // Verify the requested filename matches the episode's audio file
  const episodePath = epResult.rows[0].audio_local_path;
  if (episodePath && path.basename(episodePath) !== safeName) {
    return new NextResponse("File does not belong to this episode", { status: 404 });
  }

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
  const contentType = getContentType(resolved);
  const rangeHeader = req.headers.get("range");

  if (rangeHeader) {
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
        "Content-Type": contentType,
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
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
    },
  });
}
