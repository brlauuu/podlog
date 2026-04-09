export function episodeTimestampHref(
  episodeId: string,
  seconds: number,
  query?: string,
): string {
  const queryParam = query ? `?q=${encodeURIComponent(query)}` : "";
  return `/episodes/${episodeId}${queryParam}#t-${Math.floor(seconds)}`;
}
