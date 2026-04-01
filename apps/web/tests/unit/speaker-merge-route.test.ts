/**
 * Unit tests for speaker merge API route validation logic.
 * Tests the pure validation function without hitting the database.
 */

interface MergeRequest {
  source_labels: string[];
  target_label: string;
}

interface ValidationError {
  error: string;
}

function validateMergeRequest(body: unknown): ValidationError | null {
  const b = body as Record<string, unknown>;
  if (!b.source_labels || !Array.isArray(b.source_labels) || b.source_labels.length === 0) {
    return { error: "source_labels must be a non-empty array" };
  }
  if (!b.target_label || typeof b.target_label !== "string" || b.target_label.trim() === "") {
    return { error: "target_label must be a non-empty string" };
  }
  if (b.source_labels.includes(b.target_label)) {
    return { error: "target_label must not appear in source_labels" };
  }
  return null;
}

describe("speaker merge validation", () => {
  test("valid request passes", () => {
    const result = validateMergeRequest({
      source_labels: ["SPEAKER_01"],
      target_label: "SPEAKER_00",
    });
    expect(result).toBeNull();
  });

  test("missing source_labels returns error", () => {
    const result = validateMergeRequest({ target_label: "SPEAKER_00" });
    expect(result).toEqual({ error: "source_labels must be a non-empty array" });
  });

  test("empty source_labels returns error", () => {
    const result = validateMergeRequest({
      source_labels: [],
      target_label: "SPEAKER_00",
    });
    expect(result).toEqual({ error: "source_labels must be a non-empty array" });
  });

  test("missing target_label returns error", () => {
    const result = validateMergeRequest({ source_labels: ["SPEAKER_01"] });
    expect(result).toEqual({ error: "target_label must be a non-empty string" });
  });

  test("empty target_label returns error", () => {
    const result = validateMergeRequest({
      source_labels: ["SPEAKER_01"],
      target_label: "",
    });
    expect(result).toEqual({ error: "target_label must be a non-empty string" });
  });

  test("target_label in source_labels returns error", () => {
    const result = validateMergeRequest({
      source_labels: ["SPEAKER_00", "SPEAKER_01"],
      target_label: "SPEAKER_00",
    });
    expect(result).toEqual({ error: "target_label must not appear in source_labels" });
  });

  test("non-array source_labels returns error", () => {
    const result = validateMergeRequest({
      source_labels: "SPEAKER_01",
      target_label: "SPEAKER_00",
    });
    expect(result).toEqual({ error: "source_labels must be a non-empty array" });
  });
});
