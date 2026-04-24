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
  // FNV-1a 32-bit. Better distribution than the simple polynomial hash
  // for narrow-alphabet inputs like UUIDs (hex chars + dashes).
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0; // force unsigned
}

export function colorForFeed(feedId: string): string {
  return FEED_COLOR_PALETTE[hash(feedId) % FEED_COLOR_PALETTE.length];
}
