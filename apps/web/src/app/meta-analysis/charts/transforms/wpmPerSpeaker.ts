import type { PerFeed, PerSpeaker } from "@/lib/metaAnalysisTypes";
import { colorForFeed } from "@/lib/metaAnalysisColors";

export interface WpmBar {
  speaker_display_name: string; feed_id: string;
  feed_title: string; wpm: number; color: string;
}

export function buildWpmPerSpeaker(
  speakers: PerSpeaker[], feeds: PerFeed[], topN = 20
): WpmBar[] {
  const byFeed = new Map<string, PerSpeaker[]>();
  for (const s of speakers) {
    (byFeed.get(s.feed_id) ?? byFeed.set(s.feed_id, []).get(s.feed_id)!).push(s);
  }
  const out: WpmBar[] = [];
  for (const f of feeds) {
    const list = (byFeed.get(f.feed_id) ?? []).sort((a, b) => b.wpm - a.wpm).slice(0, topN);
    for (const s of list) {
      out.push({
        speaker_display_name: s.speaker_display_name,
        feed_id: s.feed_id, feed_title: f.title,
        wpm: s.wpm, color: colorForFeed(s.feed_id),
      });
    }
  }
  return out;
}
