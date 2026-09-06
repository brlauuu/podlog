"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";

/**
 * First-run warm-up notice for the queue page (#1047).
 *
 * On first boot the worker downloads ~3 GB of Whisper and pyannote weights
 * before it can process anything. The pipeline reports that as the Worker
 * being `WARMING_UP` in /api/health (the `prewarm_done` flag), but until
 * this banner nothing in the UI showed it: the queue page said "No episodes
 * in the queue" and a freshly added feed sat in Pending with no explanation.
 *
 * Shown only when the Database is OK and the Worker is WARMING_UP. If health
 * cannot be reached, or the database is down, the Worker is *reported* as
 * WARMING_UP by the fallback paths too, but that is a different problem with
 * its own handling, so the banner stays hidden.
 */
interface ServiceStatus {
  name: string;
  status: string;
}
interface HealthResponse {
  status: string;
  services: ServiceStatus[];
}

export const WARMUP_POLL_MS = 15_000;

export function isWorkerWarmingUp(health: HealthResponse | null | undefined): boolean {
  if (!health || !Array.isArray(health.services)) return false;
  const byName = new Map(health.services.map((s) => [s.name, s.status]));
  return byName.get("Database") === "OK" && byName.get("Worker") === "WARMING_UP";
}

export default function WorkerWarmupBanner() {
  const [warming, setWarming] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/pipeline/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setWarming(isWorkerWarmingUp(data));
      } catch {
        // Unreachable health is not "warming up"; leave the banner as it was.
      }
    }
    check();
    const id = setInterval(check, WARMUP_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  if (!warming) return null;

  return (
    <div
      role="status"
      className="flex gap-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950 px-4 py-3"
    >
      <AlertTriangle size={16} className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" />
      <div className="text-sm text-amber-800 dark:text-amber-200 space-y-1">
        <p className="font-medium">The worker is downloading speech models (about 3 GB, once).</p>
        <p>
          Episodes you add now wait in Pending and start when it finishes, usually 5–15 minutes.
          Progress is in the worker logs:{" "}
          <code className="bg-amber-100 dark:bg-amber-900 px-1 rounded text-xs">
            docker compose logs -f worker
          </code>
        </p>
      </div>
    </div>
  );
}
