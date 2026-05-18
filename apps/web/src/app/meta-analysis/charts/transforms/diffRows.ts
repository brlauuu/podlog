import type { EpisodeSpeakerDiff } from "@/lib/metaAnalysisTypes";
import type { Source } from "./speakerRows";

export function filterDiffRows(
  rows: EpisodeSpeakerDiff[],
  source: Source,
): EpisodeSpeakerDiff[] {
  return rows
    .filter((r) => r.source === source)
    .sort((a, b) =>
      (a.published_at ?? "").localeCompare(b.published_at ?? ""),
    );
}

export interface DiffSummary {
  total: number;
  guestsMore: number;
  hostsMore: number;
}

export function summarizeDiff(rows: EpisodeSpeakerDiff[]): DiffSummary {
  let guestsMore = 0;
  let hostsMore = 0;
  for (const r of rows) {
    if (r.diff > 0) guestsMore++;
    else if (r.diff < 0) hostsMore++;
  }
  return { total: rows.length, guestsMore, hostsMore };
}
