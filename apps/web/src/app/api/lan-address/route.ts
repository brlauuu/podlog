import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

/**
 * GET /api/lan-address — where to reach Podlog from another device (#1012).
 *
 * WHY THIS NEEDS THE HOST'S HELP
 *
 * The web container cannot work its own LAN address out. Inside Docker it
 * sees only the bridge:
 *
 *   $ docker compose exec web ip route get 1.1.1.1
 *   1.1.1.1 via 172.18.0.1 dev eth0  src 172.18.0.7
 *
 * while the host is on 192.168.x.x. So `make up` computes it (the same
 * detection `scripts/print-access.sh` prints) and passes it in as
 * PODLOG_LAN_URL.
 *
 * THE FALLBACK
 *
 * Started with a bare `docker compose up`, that variable is empty. Then the
 * best available answer is the address the browser used to get here — right
 * whenever you are already on the LAN, useless when you are on localhost.
 * That asymmetry is why it is the fallback rather than the primary: the case
 * worth solving is sitting at the machine with a phone in your hand.
 *
 * SILENCE OVER A WRONG ANSWER
 *
 * A loopback host is reported as nothing at all. Echoing back
 * "http://localhost:3000" would look like an answer and cannot be typed
 * into a phone.
 */

const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\]|::1)(:\d+)?$/i;

export async function GET(req: Request) {
  const fromHost = (process.env.PODLOG_LAN_URL ?? "").trim();
  if (fromHost) {
    return NextResponse.json({ url: fromHost, source: "host" });
  }

  const host = req.headers.get("host") ?? "";
  if (host && !LOOPBACK.test(host)) {
    // Same scheme the request arrived on; Podlog ships plain HTTP.
    return NextResponse.json({ url: `http://${host}`, source: "request" });
  }

  return NextResponse.json({ url: null, source: null });
}
