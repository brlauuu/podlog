/**
 * Shared fixture factory for the split EpisodesList test files.
 *
 * Not picked up by Jest: `testMatch` is `**\/*.test.{ts,tsx}`, so this
 * plain `.ts` module is only imported explicitly from the test files.
 */
import type { EnrichedEpisode } from "@/components/EpisodesList";

export function makeEpisode(overrides: Partial<EnrichedEpisode> = {}): EnrichedEpisode {
  return {
    id: "ep-1",
    title: "Test Episode 1",
    published_at: "2026-04-01T10:00:00.000Z",
    processed_at: "2026-04-01T11:00:00.000Z",
    duration_secs: 3600,
    language: "en",
    status: "done",
    has_diarization: true,
    diarization_error: null,
    error_class: null,
    error_message: null,
    retry_count: 0,
    retry_max: 3,
    transcribe_duration_secs: 120,
    diarize_duration_secs: 60,
    inference_provider_used: "fireworks",
    fireworks_audio_minutes: 60,
    fireworks_stt_cost_usd: 0.0123,
    pyannote_cloud_cost_usd: null,
    audio_file_size_bytes: null,
    speaker_count: 2,
    speaker_name_tags: [],
    ...overrides,
  };
}

/**
 * Two-episode baseline used by the display tests:
 *   ep-1 → Fireworks + 2 speakers
 *   ep-2 → local + 3 speakers, still not yet `processed_at`
 */
export const mockEpisodes: EnrichedEpisode[] = [
  makeEpisode(),
  makeEpisode({
    id: "ep-2",
    title: "Test Episode 2",
    published_at: "2026-04-02T10:00:00.000Z",
    processed_at: null,
    duration_secs: 1800,
    language: "de",
    transcribe_duration_secs: 90,
    diarize_duration_secs: 45,
    inference_provider_used: "local",
    fireworks_audio_minutes: null,
    fireworks_stt_cost_usd: null,
    pyannote_cloud_cost_usd: null,
    speaker_count: 3,
  }),
];
