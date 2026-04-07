/**
 * Format seconds as MM:SS or H:MM:SS for display.
 * Pass `{ padHours: true }` to zero-pad the hours component (e.g. for export formats).
 */
export function formatTimestamp(secs: number, { padHours = false } = {}): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);

  if (h > 0) {
    const hStr = padHours ? String(h).padStart(2, "0") : String(h);
    return `${hStr}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  if (padHours) {
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}
