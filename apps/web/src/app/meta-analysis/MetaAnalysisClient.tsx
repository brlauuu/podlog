"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SnapshotResponse, MissingSpeakersResponse } from "@/lib/metaAnalysisTypes";
import FiltersBar from "./FiltersBar";
import CoverageStrip from "./CoverageStrip";
import MissingSpeakersModal from "./MissingSpeakersModal";
import ChartCard from "./ChartCard";
import SpeakerMinutesChart from "./charts/SpeakerMinutesChart";
import SpeakerWordsChart from "./charts/SpeakerWordsChart";
import HostGuestDiffChart from "./charts/HostGuestDiffChart";
import InfoBlock from "./InfoBlock";
import ExploreStatusPanel from "./ExploreStatusPanel";
import { formatDateTime } from "@/lib/dateFormat";

async function fetchSnapshot(): Promise<SnapshotResponse> {
  const r = await fetch("/api/meta-analysis/snapshot", { cache: "no-store" });
  if (!r.ok) throw new Error("failed");
  return r.json();
}

async function refreshSnapshot(): Promise<SnapshotResponse> {
  const r = await fetch("/api/meta-analysis/refresh", { method: "POST" });
  if (!r.ok) throw new Error("refresh failed");
  return r.json();
}

export default function MetaAnalysisClient() {
  const qc = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["meta-analysis-snapshot"],
    queryFn: fetchSnapshot,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const refresh = useMutation({
    mutationFn: refreshSnapshot,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["meta-analysis-snapshot"] }),
  });

  const snap = data?.snapshot ?? null;

  const [selectedFeedIds, setSelectedFeedIds] = useState<string[]>([]);
  const [missingOpen, setMissingOpen] = useState(false);
  const [missingData, setMissingData] = useState<MissingSpeakersResponse | null>(null);

  const selectedSet = new Set(selectedFeedIds);
  const filteredSpeakerRows = (Array.isArray(snap?.per_episode_speaker) ? snap!.per_episode_speaker : [])
    .filter((r) => selectedSet.size === 0 || selectedSet.has(r.feed_id));
  const filteredDiffRows = (Array.isArray(snap?.episode_speaker_diff) ? snap!.episode_speaker_diff : [])
    .filter((r) => selectedSet.size === 0 || selectedSet.has(r.feed_id));

  const openMissing = async () => {
    try {
      const r = await fetch("/api/meta-analysis/coverage/missing-speakers", { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const d = await r.json();
      setMissingData(d);
    } catch {
      setMissingData({ podcasts: [] });
    }
    setMissingOpen(true);
  };

  if (isLoading) return <p className="text-muted-foreground">Loading meta-analysis…</p>;
  if (isError) return <p className="text-red-500">Could not load meta-analysis.</p>;

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Meta-analysis</h1>
          <p className="text-sm text-muted-foreground">
            {data?.computed_at
              ? `Updated ${formatDateTime(data.computed_at)}`
              : "Never computed"}
          </p>
          {data?.is_stale ? (
            <span
              className="inline-block mt-1 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-900 dark:bg-amber-900/40 dark:text-amber-200"
              title="A queue task changed data since this snapshot was computed. Click Refresh to recompute."
            >
              Refresh pending
            </span>
          ) : null}
        </div>
        <button
          className="px-3 py-1.5 rounded-md border text-sm"
          onClick={() => refresh.mutate()}
          disabled={refresh.isPending}
          aria-label="Refresh meta-analysis"
        >
          <span aria-hidden="true">↻</span> {refresh.isPending ? "Refreshing…" : "Refresh"}
        </button>
      </header>

      {!snap ? (
        <div className="border rounded-md p-8 text-center text-muted-foreground">
          No analysis yet — hit ↻ Refresh or wait for the queue to drain.
        </div>
      ) : (
        <>
          <ExploreStatusPanel />
          <FiltersBar
            feeds={Array.isArray(snap.per_feed) ? snap.per_feed.map((f) => ({ feed_id: f.feed_id, title: f.title })) : []}
            selectedFeedIds={selectedFeedIds}
            onSelectedChange={setSelectedFeedIds}
          />
          <CoverageStrip
            feedCount={data?.feed_count ?? 0}
            episodeCount={data?.episode_count ?? 0}
            queuedFailed={0}
            missingSpeakers={snap.coverage?.host_share?.excluded?.length ?? 0}
            onOpenMissingSpeakers={openMissing}
            onOpenQueuedFailed={() => {}}
          />
          <MissingSpeakersModal
            open={missingOpen}
            onClose={() => setMissingOpen(false)}
            data={missingData}
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <ChartCard
              title="Per-speaker minutes per episode"
              subtitle="Confirmed speakers"
            >
              <SpeakerMinutesChart rows={filteredSpeakerRows} source="confirmed" />
            </ChartCard>
            <ChartCard
              title="Per-speaker minutes per episode"
              subtitle="Inferred — HIGH confidence"
            >
              <SpeakerMinutesChart rows={filteredSpeakerRows} source="inferred_high" />
            </ChartCard>

            <ChartCard
              title="Per-speaker word count per episode"
              subtitle="Confirmed speakers"
            >
              <SpeakerWordsChart rows={filteredSpeakerRows} source="confirmed" />
            </ChartCard>
            <ChartCard
              title="Per-speaker word count per episode"
              subtitle="Inferred — HIGH confidence"
            >
              <SpeakerWordsChart rows={filteredSpeakerRows} source="inferred_high" />
            </ChartCard>

            <ChartCard
              title="Host vs Guest talking time per episode"
              subtitle="Confirmed speakers"
            >
              <HostGuestDiffChart rows={filteredDiffRows} source="confirmed" />
            </ChartCard>
            <ChartCard
              title="Host vs Guest talking time per episode"
              subtitle="Inferred — HIGH confidence"
            >
              <HostGuestDiffChart rows={filteredDiffRows} source="inferred_high" />
            </ChartCard>
          </div>
          <InfoBlock />
        </>
      )}
    </div>
  );
}
