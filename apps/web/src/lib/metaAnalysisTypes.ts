// TS types mirroring the JSONB snapshot (Issue #521).
// Keep in sync with apps/pipeline/app/services/meta_analysis.py.

export interface PerFeed {
  feed_id: string;
  title: string;
  episode_count: number;
  avg_length_min: number;
  std_length_min: number;
  total_words: number;
  total_tokens_segments: number;
  total_tokens_chunks: number;
  total_cost_usd: number;
  total_audio_minutes: number;
  inferred_host_name: string | null;
}

export interface PerEpisode {
  episode_id: string;
  feed_id: string;
  published_at: string | null;
  duration_secs: number;
  word_count: number;
  token_count_segments: number;
  token_count_chunks: number;
  speaker_count: number;
  turn_count: number;
  wpm: number;
  host_share: number | null;
  fireworks_cost_usd: number | null;
  transcribe_duration_secs: number | null;
  diarize_duration_secs: number | null;
  inference_provider_used: "fireworks" | "local" | null;
}

export interface PerSpeaker {
  speaker_display_name: string;
  normalized_name: string;
  feed_id: string;
  episode_ids: string[];
  episode_count: number;
  wpm: number;
  total_words: number;
  total_seconds: number;
  turn_count: number;
}

export interface PerEpisodeSpeaker {
  feed_id: string;
  feed_title: string;
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  display_name: string;
  role: "host" | "guest" | null;
  source: "confirmed" | "inferred_high";
  minutes: number;
  words: number;
}

export interface EpisodeSpeakerDiff {
  feed_id: string;
  feed_title: string;
  episode_id: string;
  episode_title: string;
  published_at: string | null;
  source: "confirmed" | "inferred_high";
  host_mean: number;
  host_min: number;
  host_max: number;
  host_count: number;
  host_names: string[];
  guest_mean: number;
  guest_min: number;
  guest_max: number;
  guest_count: number;
  guest_names: string[];
  diff: number;
  band_lo: number;
  band_hi: number;
}

export interface TimelineMonthly {
  month: string;           // "YYYY-MM"
  feed_id: string;
  episode_count: number;
  total_words: number;
  total_duration_min: number;
}

export interface ExcludedEpisode {
  episode_id: string;
  feed_id: string;
  feed_title: string;
  title: string;
  reason: string;
}

export interface Coverage {
  host_share: { included_count: number; excluded: ExcludedEpisode[] };
  wpm_speaker: { included_count: number; excluded: ExcludedEpisode[] };
  tokens_chunks: { included_count: number; excluded: ExcludedEpisode[] };
}

export interface MetaAnalysisSnapshot {
  per_feed: PerFeed[];
  per_episode: PerEpisode[];
  per_speaker: PerSpeaker[];
  timeline_monthly: TimelineMonthly[];
  coverage: Coverage;
  per_episode_speaker: PerEpisodeSpeaker[];
  episode_speaker_diff: EpisodeSpeakerDiff[];
}

export interface SnapshotResponse {
  snapshot: MetaAnalysisSnapshot | null;
  computed_at: string | null;
  episode_count: number;
  feed_count: number;
  is_stale: boolean;
  last_error: string | null;
}

export interface MissingSpeakersResponse {
  podcasts: Array<{
    feed_id: string;
    title: string;
    episodes: Array<{ id: string; title: string; reason: string }>;
  }>;
}

// Convenience subset for filter UIs (FiltersBar etc.) — only the
// fields needed to identify and label a feed.
export type FilterFeed = Pick<PerFeed, "feed_id" | "title">;
