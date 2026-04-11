export interface GroupedSearchResult {
  feeds: FeedGroup[];
  totalFeeds: number;
  totalEpisodes: number;
  totalMentions: number;
  coverage: EpisodeCoverage;
}

export interface FeedGroup {
  feedId: string;
  feedTitle: string;
  feedMode: string;
  mentionCount: number;
  episodes: EpisodeGroup[];
}

export interface EpisodeGroup {
  episodeId: string;
  episodeTitle: string;
  audioUrl: string;
  audioLocalPath: string | null;
  episodeUrl: string | null;
  mentionCount: number;
  bestRank: number;
}

export interface EpisodeMentions {
  episodeId: string;
  mentions: Mention[];
}

export interface ContextSegment {
  startTime: number;
  endTime: number;
  speakerLabel: string | null;
  speakerDisplay: string | null;
  text: string;
}

export interface Mention {
  id: number;
  startTime: number;
  endTime: number;
  speakerLabel: string | null;
  speakerDisplay: string | null;
  snippet: string;
  text: string;
  rank: number;
  contextBefore: ContextSegment[];
  contextAfter: ContextSegment[];
}

export interface SearchResult {
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

export interface EpisodeCoverage {
  processed: number;
  total: number;
}

export interface SearchPage {
  results: SearchResult[];
  total: number;
  page: number;
  pageSize: number;
  coverage: EpisodeCoverage;
}
