// Hash-based per-feed color assignment (Issue #521).
// Tailwind-compatible hex values. Chosen for decent contrast in both
// light and dark modes and reasonable distinctness for colorblind users.

export const FEED_COLOR_PALETTE = [
  "#6366f1", // indigo-500
  "#ec4899", // pink-500
  "#10b981", // emerald-500
  "#f59e0b", // amber-500
  "#06b6d4", // cyan-500
  "#a855f7", // purple-500
  "#ef4444", // red-500
  "#84cc16", // lime-500
  "#f97316", // orange-500
  "#3b82f6", // blue-500
] as const;

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = (h * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForFeed(feedId: string): string {
  return FEED_COLOR_PALETTE[hash(feedId) % FEED_COLOR_PALETTE.length];
}
