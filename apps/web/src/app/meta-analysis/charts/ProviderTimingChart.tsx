"use client";

import { useMemo } from "react";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";
import { summarizeProviderTiming } from "./transforms/providerTiming";

const PROVIDER_LABELS: Record<string, string> = {
  local: "Local (WhisperX + pyannote)",
  fireworks: "Fireworks (bundled)",
  unknown: "Unrecorded",
};

function fmtFactor(v: number): string {
  if (v === 0) return "—";
  // Precision scales with magnitude. Two decimals is right for ~1.87x but
  // rounds the Fireworks figure (~0.013x) to "0.01x", throwing away the digit
  // that distinguishes it from a tenth of that.
  if (v >= 1) return `${v.toFixed(2)}×`;
  if (v >= 0.01) return `${v.toFixed(3)}×`;
  return `${v.toFixed(4)}×`;
}

function fmtDuration(secs: number): string {
  if (!secs) return "—";
  if (secs < 60) return `${secs.toFixed(1)}s`;
  const h = Math.floor(secs / 3600);
  const m = Math.round((secs % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
}

function fmtWindow(first: string | null, last: string | null): string {
  if (!first || !last) return "—";
  const d = (s: string) => s.slice(0, 10);
  return d(first) === d(last) ? d(first) : `${d(first)} → ${d(last)}`;
}

/**
 * Rendered as a table rather than a bar chart (#976): with two providers and
 * a ~140x spread, a linear bar makes the faster one invisible and a log axis
 * makes the numbers hard to read — and this is a decision-support figure
 * where the values matter more than the shape.
 */
export default function ProviderTimingChart({ rows }: { rows: PerEpisode[] }) {
  const stats = useMemo(() => summarizeProviderTiming(rows), [rows]);
  const usable = stats.filter((s) => s.episodes > 0);

  if (usable.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No episodes with recorded transcription and diarization timings yet.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted-foreground">
              <th className="py-1 pr-4 font-medium">Provider</th>
              <th className="py-1 pr-4 font-medium text-right">Episodes</th>
              <th className="py-1 pr-4 font-medium text-right">Median × realtime</th>
              <th className="py-1 pr-4 font-medium text-right">Mean × realtime</th>
              <th className="py-1 pr-4 font-medium text-right">Mean wall clock</th>
              <th className="py-1 font-medium">Sample window</th>
            </tr>
          </thead>
          <tbody>
            {usable.map((s) => (
              <tr key={s.provider} className="border-t border-border">
                <td className="py-1.5 pr-4">
                  {PROVIDER_LABELS[s.provider] ?? s.provider}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums">
                  {s.episodes}
                  {s.excluded > 0 && (
                    <span
                      className="text-muted-foreground"
                      title={`${s.excluded} excluded for missing timings or zero duration`}
                    >
                      {" "}(+{s.excluded})
                    </span>
                  )}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums font-medium">
                  {fmtFactor(s.medianRealtime)}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                  {fmtFactor(s.meanRealtime)}
                </td>
                <td className="py-1.5 pr-4 text-right tabular-nums text-muted-foreground">
                  {fmtDuration(s.meanCombinedSecs)}
                </td>
                <td className="py-1.5 text-xs text-muted-foreground whitespace-nowrap">
                  {fmtWindow(s.firstPublished, s.lastPublished)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-muted-foreground">
        Transcription and diarization <strong>combined</strong>, per second of
        audio. They are not shown separately on purpose: on the Fireworks path
        the speaker labels arrive inside the transcription result, so its
        diarization step is a fraction of a second of reading JSON. Comparing
        that against local pyannote would suggest cloud diarization is
        thousands of times faster, when the work is simply billed in the
        transcription step. Figures reflect the hardware and providers in use
        during each sample window.
      </p>
    </div>
  );
}
