"use client";

import { useEffect, useState } from "react";
import { Smartphone } from "lucide-react";

/**
 * #1012: the LAN address, somewhere it survives.
 *
 * `make up` prints it once, to a terminal that scrolls away — and the
 * address is DHCP-assigned, so the moment it is most likely to have changed
 * is the moment you have no record of the old one. Anyone using the web UI
 * rather than a terminal never saw it at all.
 *
 * Renders nothing when there is no address worth showing, rather than an
 * empty card headed "Access from another device", which would be a puzzle
 * rather than information.
 */
export default function LanAccessCard() {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/lan-address", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { url: string | null } | null) => {
        if (!cancelled && data) setUrl(data.url);
      })
      .catch(() => {
        // Nothing to show is the same outcome as failing to find out.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!url) return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="flex items-center gap-2 mb-2">
        <Smartphone size={16} className="text-muted-foreground shrink-0" />
        <h2 className="text-base font-medium">Access from another device</h2>
      </div>

      <p className="text-sm text-muted-foreground mb-3">
        Open this address on a phone or another computer on the same network:
      </p>

      <code className="block rounded-md bg-muted px-3 py-2 text-sm break-all">
        {url}
      </code>

      {/* The warning from #988, kept with the address rather than left in a
          terminal. Showing the address more prominently without it would be
          a step backwards. */}
      <p className="mt-3 text-xs text-muted-foreground">
        There is <strong className="text-foreground">no login</strong>. Anyone
        who can reach that address has{" "}
        <strong className="text-foreground">full control</strong> — they can add
        and delete feeds, delete episodes and backups, and change every setting.
        Keep it to networks you trust.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        The address is assigned by your router and <em>can change</em> when it
        or this machine restarts. Reserve it in your router if you want it to
        stay put.
      </p>
    </div>
  );
}
