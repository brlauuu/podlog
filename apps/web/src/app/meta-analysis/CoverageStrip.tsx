"use client";

import Link from "next/link";

interface Props {
  feedCount: number;
  episodeCount: number;
  /**
   * Episodes not yet counted in the snapshot: in flight, queued, failed or
   * stuck. `null` while the queue is still loading, or if the queue could not
   * be reached -- the segment is hidden rather than claiming a false zero.
   */
  queuedFailed: number | null;
  missingSpeakers: number;
  onOpenMissingSpeakers: () => void;
}

export default function CoverageStrip({
  feedCount, episodeCount, queuedFailed, missingSpeakers,
  onOpenMissingSpeakers,
}: Props) {
  return (
    <div className="text-sm text-muted-foreground flex flex-wrap gap-2 items-center">
      <span>{feedCount} podcasts</span>
      <span>·</span>
      <span>{episodeCount} processed</span>
      {/*
        #970: this used to be a <button> wired to an empty handler, with the
        count hardcoded to 0 -- styled identically to the working
        missing-speakers drill-down beside it. It now carries the real count
        and links to the queue, which already presents this far better than a
        second copy inside meta-analysis would.
      */}
      {queuedFailed !== null && queuedFailed > 0 && (
        <>
          <span>·</span>
          <Link
            href="/queue"
            className="underline-offset-2 hover:underline hover:text-foreground max-md:min-h-11 max-md:inline-flex max-md:items-center"
            title="Not yet in this snapshot — open the queue"
          >
            {queuedFailed} queued/failed ▸
          </Link>
        </>
      )}
      <span>·</span>
      <button
        type="button"
        onClick={onOpenMissingSpeakers}
        className="underline-offset-2 hover:underline hover:text-foreground max-md:min-h-11 max-md:inline-flex max-md:items-center"
      >
        {missingSpeakers} missing speakers ▸
      </button>
    </div>
  );
}
