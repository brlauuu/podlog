export function validateMergeRequest(body: unknown): { error: string } | null {
  const b = body as Record<string, unknown>;
  if (!b.source_labels || !Array.isArray(b.source_labels) || b.source_labels.length === 0) {
    return { error: "source_labels must be a non-empty array" };
  }
  if (b.source_labels.some((l: unknown) => typeof l !== "string" || (l as string).trim() === "")) {
    return { error: "source_labels must contain non-empty strings" };
  }
  if (!b.target_label || typeof b.target_label !== "string" || b.target_label.trim() === "") {
    return { error: "target_label must be a non-empty string" };
  }
  if (b.source_labels.includes(b.target_label)) {
    return { error: "target_label must not appear in source_labels" };
  }
  return null;
}
