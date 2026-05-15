"use client";

import { useEffect, useState } from "react";
import { isOnDiskNewer } from "@/lib/semver";

interface VersionResponse {
  built_in: string | null;
  on_disk: string | null;
}

export default function Footer() {
  // Read NEXT_PUBLIC_APP_VERSION inside the component so tests can
  // set it per-test without juggling module-level captures. Next.js
  // inlines the value at build time in production, so this is
  // equivalent to a module-level constant for runtime cost.
  const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

  // On-disk VERSION (read from /version inside the container, see
  // docker-compose.yml). When it's strictly newer than what's baked
  // into the running image, the footer tags the version with a
  // rebuild-available hint (#744).
  const [onDisk, setOnDisk] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/version", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: VersionResponse | null) => {
        if (cancelled || !data) return;
        setOnDisk(data.on_disk);
      })
      .catch(() => {
        // Network/parse failures stay silent — equivalent to "can't compare"
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const stale = isOnDiskNewer(onDisk, APP_VERSION);

  return (
    <footer className="border-t border-border bg-background text-xs text-muted-foreground mt-auto">
      <div className="max-w-5xl mx-auto px-4 py-4 flex flex-col items-center gap-1">
        <p>
          &copy; 2026{" "}
          <a
            href="https://brlauuu.github.io"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            brlauuu
          </a>
          .{" "}
          <a
            href="https://osaasy.dev"
            className="underline hover:text-foreground"
            target="_blank"
            rel="noopener noreferrer"
          >
            O&apos;Saasy License
          </a>
        </p>
        <p>
          v{APP_VERSION}
          {stale && onDisk && (
            <span
              className="ml-2 text-amber-600 dark:text-amber-400"
              title="The VERSION file on disk is newer than the version baked into this image. Rebuild + restart to pick up the latest changes."
            >
              → {onDisk} (rebuild available)
            </span>
          )}
        </p>
      </div>
    </footer>
  );
}
