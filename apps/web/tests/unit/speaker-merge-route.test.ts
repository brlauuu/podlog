/**
 * @jest-environment node
 *
 * Unit tests for speaker merge API route validation logic.
 * Tests the pure validation function without hitting the database.
 */

import { validateMergeRequest } from "@/app/api/episodes/[id]/speakers/merge/route";

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

  test("non-string element in source_labels returns error", () => {
    const result = validateMergeRequest({
      source_labels: ["SPEAKER_01", 42],
      target_label: "SPEAKER_00",
    });
    expect(result).toEqual({ error: "source_labels must contain non-empty strings" });
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
