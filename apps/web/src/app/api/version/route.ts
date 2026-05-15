import { promises as fs } from "fs";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * `built_in` — version baked into the running image at `docker build`
 * time via the APP_VERSION arg → NEXT_PUBLIC_APP_VERSION env var.
 * Sourced from process.env so server- and client-side stay in sync.
 *
 * `on_disk` — current contents of the repo-root VERSION file,
 * bind-mounted into the container at /version (see docker-compose.yml).
 * Reading at request time lets the footer detect a bump-since-last-
 * rebuild without rebuilding to find out.
 *
 * Returns 200 on success; 200 with on_disk=null when the file is
 * missing (development mode, no mount, or the file got deleted).
 */
const VERSION_FILE_PATH = process.env.VERSION_FILE_PATH ?? "/version";

export async function GET() {
  const builtIn = process.env.NEXT_PUBLIC_APP_VERSION ?? null;
  let onDisk: string | null = null;
  try {
    const raw = await fs.readFile(VERSION_FILE_PATH, "utf-8");
    const trimmed = raw.trim();
    onDisk = trimmed.length > 0 ? trimmed : null;
  } catch {
    // File missing (no bind mount) or unreadable — degrade silently;
    // the footer will treat this as "can't compare" and stay quiet.
    onDisk = null;
  }
  return NextResponse.json({ built_in: builtIn, on_disk: onDisk });
}
