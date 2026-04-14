"use client";

import { Search } from "lucide-react";
import SearchInput from "@/components/SearchInput";
import HelpPopover from "@/components/HelpPopover";
import PodcastFilter from "@/components/PodcastFilter";
import SpeakerFilter from "@/components/SpeakerFilter";

interface Feed {
  id: string;
  title: string | null;
  episode_count: number;
}

export default function SearchTopPanel({
  submittedQuery,
  query,
  onQueryChange,
  onSubmit,
  onClear,
  coverage,
  feeds,
  selectedFeedIds,
  onFeedSelectionChange,
  hasManualUploads,
  feedsLoading,
  includeManualUploads,
  selectedSpeaker,
  onSpeakerSelectionChange,
}: {
  submittedQuery: string;
  query: string;
  onQueryChange: (value: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  onClear: () => void;
  coverage: { processed: number; total: number } | null;
  feeds: Feed[];
  selectedFeedIds: Set<string>;
  onFeedSelectionChange: (next: Set<string>) => void;
  hasManualUploads: boolean;
  feedsLoading: boolean;
  includeManualUploads: boolean;
  selectedSpeaker: string | null;
  onSpeakerSelectionChange: (speaker: string | null) => void;
}) {
  return (
    <div className={`flex flex-col items-center ${submittedQuery ? "pt-2" : "pt-16"} transition-all`}>
      <div className="w-full max-w-2xl space-y-3">
        <HelpPopover title="Search">
          <p className="font-medium mb-1">Search tips</p>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground">
            <li>Use quotes for exact phrases: &quot;machine learning&quot;</li>
            <li>Exclude words with minus: climate -politics</li>
            <li>Combine terms: AI regulation ethics</li>
            <li>Field search: title:, description:, speaker: (case-insensitive; speaker supports partial matching)</li>
          </ul>
        </HelpPopover>

        <SearchInput
          value={query}
          onChange={onQueryChange}
          onSubmit={onSubmit}
          onClear={onClear}
          placeholder="Search transcripts, titles, descriptions..."
          icon={<Search size={18} />}
        />

        {!submittedQuery && coverage && (
          <p className="text-center text-xs text-muted-foreground">
            Searching across {feeds.length} podcast
            {feeds.length !== 1 ? "s" : ""} and {" "}
            {coverage.processed} episode
            {coverage.processed !== 1 ? "s" : ""}
            {coverage.total > coverage.processed && (
              <> ({coverage.total - coverage.processed} still processing)</>
            )}
          </p>
        )}

        <div className="flex justify-center gap-2 flex-wrap">
          <PodcastFilter
            feeds={feeds}
            selectedFeedIds={selectedFeedIds}
            onSelectionChange={onFeedSelectionChange}
            hasManualUploads={hasManualUploads}
            loading={feedsLoading && feeds.length === 0 && !hasManualUploads}
          />
          <SpeakerFilter
            feedIds={Array.from(selectedFeedIds)}
            includeManualUploads={includeManualUploads}
            selectedSpeaker={selectedSpeaker}
            onSelectionChange={onSpeakerSelectionChange}
          />
        </div>
      </div>
    </div>
  );
}
