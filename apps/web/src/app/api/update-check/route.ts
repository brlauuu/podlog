import { NextResponse } from "next/server";

import { compareSemver, parseSemver } from "@/lib/semver";

export const dynamic = "force-dynamic";

/**
 * GET /api/update-check — is there a newer Podlog release? (#937 phase 5)
 *
 * OFF BY DEFAULT, ON PURPOSE
 *
 * A self-hosted app should not phone home because someone opened a page.
 * Podlog's whole premise is that nothing leaves your machine except RSS
 * polling and model downloads, so this stays silent until the operator sets
 * UPDATE_CHECK_ENABLED=true. When it is off, no request is made and no
 * network stack is touched -- there are tests asserting exactly that,
 * because "we only call out when enabled" is the kind of claim that rots
 * quietly.
 *
 * SERVER-SIDE, NOT FROM THE BROWSER
 *
 * The check runs here rather than in the footer so the request comes from
 * the host once, not from every visitor's browser. On a LAN install that is
 * the difference between one outbound call and one per device per page.
 *
 * FAILURE IS SILENCE
 *
 * Offline, air-gapped, rate-limited, DNS blocked: all return
 * `latest: null`, which the footer renders as nothing. An update check is
 * not important enough to put an error in front of someone.
 */

const RELEASES_URL = "https://api.github.com/repos/brlauuu/podlog/releases/latest";

// Every page render calls this route. Without a cache, a tab left open would
// spend the unauthenticated GitHub rate limit (60/hour/IP) by itself.
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

let cache: { at: number; latest: string | null } | null = null;

function enabled(): boolean {
  return (process.env.UPDATE_CHECK_ENABLED ?? "").toLowerCase() === "true";
}

async function fetchLatestTag(): Promise<string | null> {
  try {
    const resp = await fetch(RELEASES_URL, {
      headers: { Accept: "application/vnd.github+json" },
      // Belt and braces: a hung connection must not hold a page render.
      signal: AbortSignal.timeout(5000),
      cache: "no-store",
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as { tag_name?: string };
    const tag = (data?.tag_name ?? "").replace(/^v/, "").trim();
    return tag.length > 0 ? tag : null;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!enabled()) {
    return NextResponse.json({ enabled: false, current: null, latest: null });
  }

  const current = process.env.NEXT_PUBLIC_APP_VERSION ?? null;

  const fresh = cache && Date.now() - cache.at < CACHE_TTL_MS;
  if (!fresh) {
    cache = { at: Date.now(), latest: await fetchLatestTag() };
  }

  // Report `latest` only when it is strictly newer than what is running.
  // Equal is the normal case and not worth a badge; older happens after a
  // deliberate downgrade, where nagging would be actively wrong.
  const running = parseSemver(current ?? "");
  const newest = parseSemver(cache?.latest ?? "");
  const isNewer = running && newest && compareSemver(newest, running) === 1;

  return NextResponse.json({
    enabled: true,
    current,
    latest: isNewer ? cache!.latest : null,
  });
}
