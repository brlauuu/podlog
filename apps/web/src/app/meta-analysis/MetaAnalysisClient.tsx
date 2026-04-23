"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import type { SnapshotResponse, MissingSpeakersResponse } from "@/lib/metaAnalysisTypes";
import FiltersBar from "./FiltersBar";
import CoverageStrip from "./CoverageStrip";
import MissingSpeakersModal from "./MissingSpeakersModal";
import ChartCard from "./ChartCard";
import EpisodeLengthTrend from "./charts/EpisodeLengthTrend";
import HostGuestShare from "./charts/HostGuestShare";
import LengthPerFeed from "./charts/LengthPerFeed";
import ReleaseTimeline from "./charts/ReleaseTimeline";
import TurnDensity from "./charts/TurnDensity";
import WpmPerSpeaker from "./charts/WpmPerSpeaker";
import TokensPerEpisode from "./charts/TokensPerEpisode";
import InfoBlock from "./InfoBlock";

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

  const filteredFeeds = snap
    ? (Array.isArray(snap.per_feed)
        ? (selectedFeedIds.length === 0
            ? snap.per_feed
            : snap.per_feed.filter((f) => selectedFeedIds.includes(f.feed_id)))
        : [])
    : [];

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
              ? `Updated ${new Date(data.computed_at).toLocaleString()}`
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
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            <ChartCard title="Episode length per podcast" subtitle="Avg (min) · σ error bars">
              <LengthPerFeed feeds={filteredFeeds} />
            </ChartCard>
            <ChartCard title="Episodes published per month" subtitle="Stacked by podcast">
              <ReleaseTimeline
                timeline={Array.isArray(snap.timeline_monthly) ? snap.timeline_monthly : []}
                feeds={filteredFeeds}
              />
            </ChartCard>
            <ChartCard title="Episode length trend" subtitle="Per podcast over time">
              <EpisodeLengthTrend
                episodes={Array.isArray(snap.per_episode) ? snap.per_episode : []}
                feeds={filteredFeeds}
              />
            </ChartCard>
            {(() => {
              const hostShareCoverage = snap.coverage?.host_share;
              return (
                <ChartCard
                  title="Host vs guest share"
                  subtitle="% speech · confirmed hosts only"
                  coverage={hostShareCoverage ? {
                    included: hostShareCoverage.included_count,
                    total: hostShareCoverage.included_count + (Array.isArray(hostShareCoverage.excluded) ? hostShareCoverage.excluded.length : 0),
                    onClickExcluded: openMissing,
                  } : undefined}
                >
                  <HostGuestShare
                    episodes={Array.isArray(snap.per_episode) ? snap.per_episode : []}
                    feeds={filteredFeeds}
                  />
                </ChartCard>
              );
            })()}
            <ChartCard title="Turn density" subtitle="Episode length × speaker turns/min">
              <TurnDensity
                episodes={Array.isArray(snap.per_episode) ? snap.per_episode : []}
                feeds={filteredFeeds}
              />
            </ChartCard>
            <ChartCard title="Words per minute per speaker"
              subtitle="Top 20 per podcast · confirmed speakers only">
              <WpmPerSpeaker
                speakers={Array.isArray(snap.per_speaker) ? snap.per_speaker : []}
                feeds={filteredFeeds}
              />
            </ChartCard>
            <ChartCard title="Tokens per episode" subtitle="Segments vs chunks · estimated (cl100k_base)">
              <TokensPerEpisode episodes={Array.isArray(snap.per_episode) ? snap.per_episode : []} />
            </ChartCard>
          </div>
          <InfoBlock />
        </>
      )}
    </div>
  );
}
