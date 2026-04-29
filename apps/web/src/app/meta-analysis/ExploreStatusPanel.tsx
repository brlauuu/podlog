"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ExploreStatus {
  running: boolean;
  url: string | null;
  error: string | null;
}

/**
 * Subtle status indicator for the optional Jupyter exploration service
 * (#607). Sits near InfoBlock at the bottom of /meta-analysis. Two states:
 *
 *   - Running: link to the Jupyter URL + collapsible "how to get the token".
 *   - Not running: pointer to the docs explaining how to start it.
 *
 * Per the issue: this is an advanced feature; the panel is intentionally
 * understated. No start/stop controls — the user manages the container
 * with `make explore` from the CLI.
 */
export default function ExploreStatusPanel() {
  const [status, setStatus] = useState<ExploreStatus | null>(null);
  const [tokenHelpOpen, setTokenHelpOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/pipeline/explore/status")
      .then((r) => r.json())
      .then((data: ExploreStatus) => {
        if (!cancelled) setStatus(data);
      })
      .catch(() => {
        // Soft fail: the panel just doesn't render. Users who need it can
        // hit the API endpoint directly.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!status) return null;

  if (status.running && status.url) {
    return (
      <div className="border rounded-md p-3 text-xs bg-muted/30 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span aria-hidden="true" className="text-green-600 dark:text-green-400">
            ●
          </span>
          <span className="font-medium">Explore notebook is running.</span>
          <a
            href={status.url}
            target="_blank"
            rel="noreferrer"
            className="text-link hover:underline"
          >
            Open Jupyter →
          </a>
          <span className="text-muted-foreground">·</span>
          <button
            type="button"
            onClick={() => setTokenHelpOpen((v) => !v)}
            className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
            aria-expanded={tokenHelpOpen}
          >
            {tokenHelpOpen ? "Hide token help" : "How do I get the token?"}
          </button>
        </div>
        {tokenHelpOpen && (
          <p className="text-muted-foreground pt-1">
            Jupyter generates a fresh token on every container start. Run{" "}
            <code className="rounded bg-muted px-1">make explore-logs</code> in
            your terminal and copy the URL ending in{" "}
            <code className="rounded bg-muted px-1">?token=...</code>. The token
            sits in a cookie after first use, so subsequent visits don&apos;t
            need it again until the container restarts.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="border rounded-md p-3 text-xs bg-muted/30">
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className="text-muted-foreground">
          ○
        </span>
        <span>Explore notebook is not running.</span>
        <Link
          href="/docs?page=16-explore"
          className="text-link hover:underline"
        >
          See the docs →
        </Link>
        <span className="text-muted-foreground">
          (advanced: pandas + Plotly notebooks against the Podlog DB)
        </span>
      </div>
    </div>
  );
}
