"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, XCircle } from "lucide-react";

/**
 * Health-derived notices for the queue page.
 *
 * - Warm-up (#1047): on first boot the worker downloads ~3 GB of Whisper and
 *   pyannote weights before it can process anything. The pipeline reports
 *   that as the Worker being `WARMING_UP` in /api/health (the `prewarm_done`
 *   flag), but until this banner nothing in the UI showed it: the queue page
 *   said "No episodes in the queue" and a freshly added feed sat in Pending
 *   with no explanation.
 * - Diarization pre-flight (#1048): a bad HF_TOKEN or an unaccepted pyannote
 *   licence used to surface only as the first episode finishing without
 *   speakers, an hour later. The pipeline now checks up front and reports a
 *   `Diarization` service as DEGRADED with a `detail` saying what to do.
 *
 * Both are shown only when the Database is OK. If health cannot be reached,
 * or the database is down, the fallback paths report the Worker as
 * WARMING_UP too, but that is a different problem with its own handling, so
 * nothing is shown.
 */
interface ServiceStatus {
  name: string;
  status: string;
  detail?: string | null;
}
interface HealthResponse {
  status: string;
  services: ServiceStatus[];
}

export const HEALTH_POLL_MS = 15_000;

function byName(health: HealthResponse | null | undefined): Map<string, ServiceStatus> | null {
  if (!health || !Array.isArray(health.services)) return null;
  return new Map(health.services.map((s) => [s.name, s]));
}

export function isWorkerWarmingUp(health: HealthResponse | null | undefined): boolean {
  const m = byName(health);
  return !!m && m.get("Database")?.status === "OK" && m.get("Worker")?.status === "WARMING_UP";
}

/** The pre-flight's reason when diarization cannot work, else null. */
export function diarizationProblem(health: HealthResponse | null | undefined): string | null {
  const m = byName(health);
  if (!m || m.get("Database")?.status !== "OK") return null;
  const d = m.get("Diarization");
  if (!d || d.status !== "DEGRADED") return null;
  return d.detail || "Diarization cannot run with the current HuggingFace token.";
}

/** Turn the one URL the pre-flight detail may contain into a link. */
function withLink(text: string) {
  const m = text.match(/https:\/\/huggingface\.co\/\S+?(?=[,.\s]|$)/);
  if (!m || m.index === undefined) return text;
  const url = m[0];
  return (
    <>
      {text.slice(0, m.index)}
      <a href={url} target="_blank" rel="noreferrer" className="underline">
        {url}
      </a>
      {text.slice(m.index + url.length)}
    </>
  );
}

export default function HealthNotices() {
  const [health, setHealth] = useState<HealthResponse | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      try {
        const res = await fetch("/api/pipeline/health", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as HealthResponse;
        if (!cancelled) setHealth(data);
      } catch {
        // Unreachable health is not a notice; leave things as they were.
      }
    }
    check();
    const id = setInterval(check, HEALTH_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const warming = isWorkerWarmingUp(health);
  const diarization = diarizationProblem(health);
  if (!warming && !diarization) return null;

  return (
    <div className="space-y-3">
      {warming && (
        <div
          role="status"
          data-notice="warmup"
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
      )}
      {diarization && (
        <div
          role="alert"
          data-notice="diarization"
          className="flex gap-3 rounded-lg border border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-950 px-4 py-3"
        >
          <XCircle size={16} className="text-red-600 dark:text-red-400 mt-0.5 shrink-0" />
          <div className="text-sm text-red-800 dark:text-red-200 space-y-1">
            <p className="font-medium">Speaker diarization will fail until this is fixed.</p>
            <p>{withLink(diarization)}</p>
            <p>
              Transcripts still get written, without speaker labels. This check runs again every few
              minutes, so the notice clears on its own once it is fixed.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
