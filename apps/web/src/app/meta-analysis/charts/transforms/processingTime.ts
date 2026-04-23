import type { PerEpisode } from "@/lib/metaAnalysisTypes";

export interface ProcBox { provider: string; seconds: number[]; }

export function buildProcessingTime(eps: PerEpisode[]): ProcBox[] {
  const byProv: Record<string, number[]> = {};
  for (const ep of eps) {
    const total = (ep.transcribe_duration_secs ?? 0) + (ep.diarize_duration_secs ?? 0);
    if (total <= 0) continue;
    const p = ep.inference_provider_used ?? "local";
    (byProv[p] ??= []).push(total);
  }
  return Object.entries(byProv).map(([provider, seconds]) => ({ provider, seconds }));
}
