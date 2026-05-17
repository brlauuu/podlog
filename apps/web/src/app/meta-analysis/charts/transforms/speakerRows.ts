import type { PerEpisodeSpeaker } from "@/lib/metaAnalysisTypes";

export type Source = "confirmed" | "inferred_high";
export type Metric = "minutes" | "words";
const HOST_THRESHOLD = 0.25;

function key(feed_id: string, display_name: string): string {
  return `${feed_id}|${display_name}`;
}

export function classifyRoles(
  rows: PerEpisodeSpeaker[],
  source: Source,
): Map<string, boolean> {
  if (source === "confirmed") {
    const counts = new Map<string, { host: number; guest: number }>();
    for (const r of rows) {
      if (r.source !== "confirmed") continue;
      if (r.role !== "host" && r.role !== "guest") continue;
      const k = key(r.feed_id, r.display_name);
      const c = counts.get(k) ?? { host: 0, guest: 0 };
      c[r.role] += 1;
      counts.set(k, c);
    }
    const out = new Map<string, boolean>();
    for (const [k, c] of counts) out.set(k, c.host >= c.guest);
    return out;
  }

  // Inferred: inherit from confirmed when known, else 25% fallback.
  const confirmed = classifyRoles(rows, "confirmed");

  const speakerEps = new Map<string, Set<string>>();
  const feedEps = new Map<string, Set<string>>();
  for (const r of rows) {
    if (r.source !== "inferred_high") continue;
    const k = key(r.feed_id, r.display_name);
    if (!speakerEps.has(k)) speakerEps.set(k, new Set());
    speakerEps.get(k)!.add(r.episode_id);
    if (!feedEps.has(r.feed_id)) feedEps.set(r.feed_id, new Set());
    feedEps.get(r.feed_id)!.add(r.episode_id);
  }
  const out = new Map<string, boolean>();
  for (const k of speakerEps.keys()) {
    if (confirmed.has(k)) {
      out.set(k, confirmed.get(k)!);
    } else {
      const [feed_id] = k.split("|");
      const total = feedEps.get(feed_id)?.size ?? 0;
      const spk = speakerEps.get(k)?.size ?? 0;
      out.set(k, total > 0 && spk / total >= HOST_THRESHOLD);
    }
  }
  return out;
}

export interface HostPoint {
  display_name: string;
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  value: number;
}

export interface CombinedGuestPoint {
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  value: number;
  guest_count: number;
  guest_names: string[];
}

export interface FeedSeries {
  feed_id: string;
  feed_title: string;
  hosts: { display_name: string; points: HostPoint[] }[];
  combinedGuests: CombinedGuestPoint[];
}

export function buildSpeakerSeries(
  rows: PerEpisodeSpeaker[],
  metric: Metric,
  source: Source,
): Map<string, FeedSeries> {
  const filtered = rows.filter((r) => r.source === source);
  const roles = classifyRoles(rows, source);
  const valueOf = (r: PerEpisodeSpeaker) => (metric === "minutes" ? r.minutes : r.words);

  const byFeed = new Map<string, PerEpisodeSpeaker[]>();
  for (const r of filtered) {
    if (!byFeed.has(r.feed_id)) byFeed.set(r.feed_id, []);
    byFeed.get(r.feed_id)!.push(r);
  }

  const out = new Map<string, FeedSeries>();
  for (const [feed_id, feedRows] of byFeed) {
    const hostRows: PerEpisodeSpeaker[] = [];
    const guestRows: PerEpisodeSpeaker[] = [];
    for (const r of feedRows) {
      if (roles.get(key(r.feed_id, r.display_name))) hostRows.push(r);
      else guestRows.push(r);
    }

    // Host series: per name, sorted by published_at.
    const hostByName = new Map<string, HostPoint[]>();
    for (const r of hostRows) {
      const pts = hostByName.get(r.display_name) ?? [];
      pts.push({
        display_name: r.display_name,
        episode_id: r.episode_id,
        episode_title: r.episode_title,
        published_at: r.published_at,
        value: valueOf(r),
      });
      hostByName.set(r.display_name, pts);
    }
    const hosts = Array.from(hostByName.entries())
      .map(([display_name, points]) => ({
        display_name,
        points: points.sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? "")),
      }))
      .sort((a, b) =>
        b.points.reduce((s, p) => s + p.value, 0) -
        a.points.reduce((s, p) => s + p.value, 0)
      );

    // Combined guests: group by episode, sum values, list names.
    const byEp = new Map<string, CombinedGuestPoint>();
    for (const r of guestRows) {
      const existing = byEp.get(r.episode_id);
      if (existing) {
        existing.value += valueOf(r);
        if (!existing.guest_names.includes(r.display_name)) {
          existing.guest_names.push(r.display_name);
        }
        existing.guest_count = existing.guest_names.length;
      } else {
        byEp.set(r.episode_id, {
          episode_id: r.episode_id,
          episode_title: r.episode_title,
          published_at: r.published_at,
          value: valueOf(r),
          guest_count: 1,
          guest_names: [r.display_name],
        });
      }
    }
    const combinedGuests = Array.from(byEp.values())
      .map((p) => ({ ...p, guest_names: [...p.guest_names].sort() }))
      .sort((a, b) => (a.published_at ?? "").localeCompare(b.published_at ?? ""));

    out.set(feed_id, {
      feed_id,
      feed_title: feedRows[0].feed_title,
      hosts,
      combinedGuests,
    });
  }
  return out;
}
