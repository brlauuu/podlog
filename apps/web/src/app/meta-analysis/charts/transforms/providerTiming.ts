import type { PerEpisode } from "@/lib/metaAnalysisTypes";

/**
 * Aggregate processing speed per inference provider (#976).
 *
 * Two things this deliberately gets right, because getting either wrong
 * produces a confidently wrong answer:
 *
 * 1. **Combined transcribe + diarize, never diarize alone.** On the Fireworks
 *    path the speaker labels arrive inside the transcription artifact and the
 *    diarize task only reads that JSON and rebuilds segments, so its diarize
 *    time is ~0.2s. Charting that against local pyannote's hours would read as
 *    "cloud diarization is 40,000x faster". The diarization cost is real; it
 *    is just billed inside the transcribe step.
 *
 * 2. **Normalized by audio length.** The local sample averages ~120 min per
 *    episode against Fireworks' ~74 min, so raw seconds overstate the gap.
 *    Seconds of processing per second of audio ("x realtime") is the honest
 *    unit.
 *
 * Grouping is by whatever provider string the episode carries, so a third
 * provider appears on its own rather than needing a code change.
 */
export interface ProviderTiming {
  provider: string;
  /** Episodes with usable timings. */
  episodes: number;
  /** Episodes dropped for missing timings or zero duration. */
  excluded: number;
  medianRealtime: number;
  meanRealtime: number;
  /** Mean seconds, secondary to the normalized figure above. */
  meanCombinedSecs: number;
  firstPublished: string | null;
  lastPublished: string | null;
}

function median(sorted: number[]): number {
  if (sorted.length === 0) return 0;
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function summarizeProviderTiming(rows: PerEpisode[]): ProviderTiming[] {
  interface Acc {
    factors: number[];
    combinedSecs: number[];
    excluded: number;
    published: string[];
  }
  const acc = new Map<string, Acc>();

  for (const r of rows) {
    const provider = r.inference_provider_used ?? "unknown";
    let a = acc.get(provider);
    if (!a) {
      a = { factors: [], combinedSecs: [], excluded: 0, published: [] };
      acc.set(provider, a);
    }

    const t = r.transcribe_duration_secs;
    const d = r.diarize_duration_secs;
    // A zero-length episode would divide by zero; a missing timing would make
    // the episode look instantaneous. Both are excluded and counted, rather
    // than silently skewing the average.
    if (t == null || d == null || !r.duration_secs || r.duration_secs <= 0) {
      a.excluded++;
      continue;
    }

    a.factors.push((t + d) / r.duration_secs);
    a.combinedSecs.push(t + d);
    if (r.published_at) a.published.push(r.published_at);
  }

  const out: ProviderTiming[] = [];
  for (const [provider, a] of acc) {
    const sorted = [...a.factors].sort((x, y) => x - y);
    const n = a.factors.length;
    const dates = [...a.published].sort();
    out.push({
      provider,
      episodes: n,
      excluded: a.excluded,
      medianRealtime: median(sorted),
      meanRealtime: n ? a.factors.reduce((s, v) => s + v, 0) / n : 0,
      meanCombinedSecs: n ? a.combinedSecs.reduce((s, v) => s + v, 0) / n : 0,
      firstPublished: dates[0] ?? null,
      lastPublished: dates[dates.length - 1] ?? null,
    });
  }

  return out.sort((x, y) => y.episodes - x.episodes);
}
