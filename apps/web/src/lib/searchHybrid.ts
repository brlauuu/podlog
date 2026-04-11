interface HybridSearchResultItem {
  id: number;
  startTime: number;
  endTime: number;
  speakerLabel: string | null;
  speakerDisplay: string | null;
  snippet: string;
  rank: number;
  episodeId: string;
  episodeTitle: string | null;
  audioUrl: string;
  audioLocalPath: string | null;
  episodeUrl: string | null;
  hasDiarization: boolean;
  diarizationError: string | null;
  feedTitle: string | null;
  feedMode: string;
  feedId: string;
}

interface MergedEntry extends HybridSearchResultItem {
  ftsRank?: number;
  vecRank?: number;
  rrfScore: number;
}

interface MergeHybridSearchResultsArgs {
  ftsRows: Array<Record<string, unknown>>;
  vecRows: Array<Record<string, unknown>>;
  page: number;
  pageSize: number;
  ftsTotal: number;
  rrfK?: number;
}

interface MergeHybridSearchResultsResult {
  results: HybridSearchResultItem[];
  total: number;
}

function toNum(value: unknown): number {
  if (typeof value === "number") return value;
  return Number.parseFloat(String(value ?? 0));
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

function toStringValue(value: unknown, fallback = ""): string {
  if (value === null || value === undefined) return fallback;
  return String(value);
}

function bucketKey(episodeId: string, startTime: number): string {
  return `${episodeId}:${Math.floor(startTime / 30)}`;
}

function truncateSnippet(text: string, maxLen = 200): string {
  if (text.length <= maxLen) return text;
  return `${text.slice(0, maxLen).replace(/\s\S*$/, "")}…`;
}

export function mergeHybridSearchResults({
  ftsRows,
  vecRows,
  page,
  pageSize,
  ftsTotal,
  rrfK = 60,
}: MergeHybridSearchResultsArgs): MergeHybridSearchResultsResult {
  const merged = new Map<string, MergedEntry>();

  ftsRows.forEach((row, i) => {
    const episodeId = toStringValue(row.episode_id);
    const startTime = toNum(row.start_time);
    const key = bucketKey(episodeId, startTime);
    merged.set(key, {
      id: toNum(row.id),
      startTime,
      endTime: toNum(row.end_time),
      speakerLabel: toStringOrNull(row.speaker_label),
      speakerDisplay: toStringOrNull(row.speaker_display),
      snippet: toStringValue(row.snippet),
      rank: toNum(row.rank),
      episodeId,
      episodeTitle: toStringOrNull(row.episode_title),
      audioUrl: toStringValue(row.audio_url),
      audioLocalPath: toStringOrNull(row.audio_local_path),
      episodeUrl: toStringOrNull(row.episode_url),
      hasDiarization: Boolean(row.has_diarization),
      diarizationError: toStringOrNull(row.diarization_error),
      feedTitle: toStringOrNull(row.feed_title),
      feedMode: toStringValue(row.feed_mode),
      feedId: toStringValue(row.feed_id),
      ftsRank: i + 1,
      rrfScore: 1 / (rrfK + i + 1),
    });
  });

  vecRows.forEach((row, i) => {
    const episodeId = toStringValue(row.episode_id);
    const startTime = toNum(row.start_time);
    const key = bucketKey(episodeId, startTime);
    const vecScore = 1 / (rrfK + i + 1);
    const existing = merged.get(key);
    if (existing) {
      existing.vecRank = i + 1;
      existing.rrfScore += vecScore;
      return;
    }

    merged.set(key, {
      id: toNum(row.id),
      startTime,
      endTime: toNum(row.end_time),
      speakerLabel: toStringOrNull(row.speaker_label),
      speakerDisplay: toStringOrNull(row.speaker_display),
      snippet: truncateSnippet(toStringValue(row.text)),
      rank: toNum(row.similarity),
      episodeId,
      episodeTitle: toStringOrNull(row.episode_title),
      audioUrl: toStringValue(row.audio_url),
      audioLocalPath: toStringOrNull(row.audio_local_path),
      episodeUrl: toStringOrNull(row.episode_url),
      hasDiarization: Boolean(row.has_diarization),
      diarizationError: toStringOrNull(row.diarization_error),
      feedTitle: toStringOrNull(row.feed_title),
      feedMode: toStringValue(row.feed_mode),
      feedId: toStringValue(row.feed_id),
      vecRank: i + 1,
      rrfScore: vecScore,
    });
  });

  const sorted = Array.from(merged.values()).sort((a, b) => b.rrfScore - a.rrfScore);
  const offset = (page - 1) * pageSize;
  const results = sorted.slice(offset, offset + pageSize);
  const total = ftsTotal >= 0 ? Math.max(ftsTotal, sorted.length) : -1;
  return { results, total };
}
