"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

interface ExploreStatus {
  running: boolean;
  url: string | null;
  error: string | null;
}

/**
 * Status indicator + getting-started panel for the optional Jupyter
 * exploration service (#607, repositioned to the top by #690).
 *
 *   - Running: link to the Jupyter URL + collapsible "how to get the token".
 *   - Not running: collapsible "how to start it" with the CLI commands,
 *     plus a link to the docs for more detail.
 *
 * Per the original issue (#607): this is an advanced feature; no start/stop
 * controls — the user manages the container with `make explore` from the CLI.
 */
export default function ExploreStatusPanel() {
  const [status, setStatus] = useState<ExploreStatus | null>(null);
  const [open, setOpen] = useState(false);

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

  const isRunning = status.running && status.url;

  return (
    <div className="border rounded-md p-3 text-xs bg-muted/30 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <span
          aria-hidden="true"
          className={
            isRunning
              ? "text-green-600 dark:text-green-400"
              : "text-muted-foreground"
          }
        >
          {isRunning ? "●" : "○"}
        </span>
        <span className="font-medium">
          {isRunning
            ? "Explore notebook is running."
            : "Explore notebook is not running."}
        </span>
        {isRunning && status.url && (
          <a
            href={status.url}
            target="_blank"
            rel="noreferrer"
            className="text-link hover:underline"
          >
            Open Jupyter →
          </a>
        )}
        <span className="text-muted-foreground">·</span>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          aria-expanded={open}
        >
          {open
            ? "Hide details"
            : isRunning
            ? "How do I get the token?"
            : "Show how to start it"}
        </button>
        {!isRunning && (
          <Link
            href="/docs?page=16-explore"
            className="text-link hover:underline"
          >
            Docs →
          </Link>
        )}
      </div>

      {open && isRunning && (
        <p className="text-muted-foreground pt-1">
          Jupyter generates a fresh token on every container start. Run{" "}
          <code className="rounded bg-muted px-1">make explore-logs</code> in
          your terminal and copy the URL ending in{" "}
          <code className="rounded bg-muted px-1">?token=...</code>. The token
          sits in a cookie after first use, so subsequent visits don&apos;t
          need it again until the container restarts.
        </p>
      )}

      {open && !isRunning && (
        <div className="pt-1 space-y-2 text-muted-foreground">
          <p>
            Run from your terminal in the repo root. Advanced feature — pandas
            + Plotly notebooks against the Podlog DB.
          </p>
          <pre className="rounded bg-muted px-2 py-1.5 font-mono text-[11px] leading-relaxed whitespace-pre overflow-x-auto">
{`# Start the Jupyter container
make explore

# Print the access URL (with ?token=...)
make explore-logs`}
          </pre>
          <p>
            Once it&apos;s running, this panel will show a green dot and an
            &ldquo;Open Jupyter&rdquo; link. See the{" "}
            <Link
              href="/docs?page=16-explore"
              className="text-link hover:underline"
            >
              explore guide
            </Link>{" "}
            for the full walkthrough.
          </p>
        </div>
      )}
    </div>
  );
}
