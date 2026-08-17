/**
 * @jest-environment node
 */
import { PIPELINE_STEPS } from "@/components/RemoteInferencePipelineSteps";

const embedding = PIPELINE_STEPS.find((s) => s.key === "embedding");

describe("embedding pipeline step (#944)", () => {
  it("exists", () => {
    expect(embedding).toBeDefined();
  });

  // Fireworks retired its serverless embeddings API. Offering the remote
  // toggle hands the user a silently broken pipeline: embed jobs fail, the
  // affected episodes never reach 'done', and they vanish from search.
  it("does not offer a remote option", () => {
    expect(embedding!.remoteAvailable).toBe(false);
    expect(embedding!.remoteModels).toEqual([]);
    expect(embedding!.remoteModelField).toBeNull();
  });

  it("explains why remote is unavailable, so the gap is not a mystery", () => {
    expect(embedding!.disabledReason).toBeTruthy();
    expect(embedding!.disabledReason).toMatch(/Fireworks/);
  });

  // Installs that previously embedded through Fireworks have a bge-small
  // corpus. Running that same model locally reproduces those vectors exactly,
  // so it must stay selectable or those users cannot recover without
  // re-embedding everything.
  it("offers bge-small locally so a Fireworks-built corpus stays usable", () => {
    const values = embedding!.localModels.map((m) => m.value);
    expect(values).toContain("BAAI/bge-small-en-v1.5");
    expect(values).toContain("all-MiniLM-L6-v2");
  });

  it("still points at the local model field so the choice is persistable", () => {
    expect(embedding!.modelField).toBe("embedding_model");
    expect(embedding!.providerField).toBe("embedding_provider");
  });
});
