"use client";

interface Props {
  feedCount: number;
  episodeCount: number;
  queuedFailed: number;
  missingSpeakers: number;
  onOpenMissingSpeakers: () => void;
  onOpenQueuedFailed: () => void;
}

export default function CoverageStrip({
  feedCount, episodeCount, queuedFailed, missingSpeakers,
  onOpenMissingSpeakers, onOpenQueuedFailed,
}: Props) {
  return (
    <div className="text-sm text-muted-foreground flex flex-wrap gap-2 items-center">
      <span>{feedCount} podcasts</span>
      <span>·</span>
      <span>{episodeCount} processed</span>
      <span>·</span>
      <button
        type="button"
        onClick={onOpenQueuedFailed}
        className="underline-offset-2 hover:underline hover:text-foreground"
      >
        {queuedFailed} queued/failed ▸
      </button>
      <span>·</span>
      <button
        type="button"
        onClick={onOpenMissingSpeakers}
        className="underline-offset-2 hover:underline hover:text-foreground"
      >
        {missingSpeakers} missing speakers ▸
      </button>
    </div>
  );
}
