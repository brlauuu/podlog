import { parseSearchQuery } from "@/lib/search/queryParser";

export interface FilterOpts {
  speakerLabel: string | null;
  speakerLike: string | null;
  titleFilter: string | null;
  descriptionFilter: string | null;
}

export function buildMetadataSnippet(
  row: { episode_title: string | null; episode_description: string | null },
  parsed: ReturnType<typeof parseSearchQuery>
): string {
  if (parsed.titleFilter && row.episode_title) {
    return `Title match: ${row.episode_title}`;
  }
  if (parsed.descriptionFilter && row.episode_description) {
    const trimmed = row.episode_description.trim();
    return trimmed.length > 240 ? `${trimmed.slice(0, 240)}...` : trimmed;
  }
  if (parsed.speakerFilter) {
    return `Speaker match: ${parsed.speakerFilter}`;
  }
  return row.episode_title ?? "Episode match";
}
