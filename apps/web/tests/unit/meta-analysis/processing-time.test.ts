import { buildProcessingTime } from "@/app/meta-analysis/charts/transforms/processingTime";
import type { PerEpisode } from "@/lib/metaAnalysisTypes";

const EPS: PerEpisode[] = [
  { episode_id: "1", feed_id: "a", transcribe_duration_secs: 100,
    diarize_duration_secs: 50, inference_provider_used: "local" } as PerEpisode,
  { episode_id: "2", feed_id: "a", transcribe_duration_secs: 30,
    diarize_duration_secs: 20, inference_provider_used: "fireworks" } as PerEpisode,
];

describe("buildProcessingTime", () => {
  it("splits by provider and sums transcribe+diarize", () => {
    const rows = buildProcessingTime(EPS);
    const local = rows.find((r) => r.provider === "local")!;
    const remote = rows.find((r) => r.provider === "fireworks")!;
    expect(local.seconds).toEqual([150]);
    expect(remote.seconds).toEqual([50]);
  });
});
