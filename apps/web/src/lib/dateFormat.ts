/**
 * Calendar date formatting helpers. App-wide convention is DD/MM/YYYY.
 *
 * Accepts ISO strings, Date objects, epoch numbers, or null/undefined.
 * Returns an empty string for null/undefined/invalid inputs so call sites
 * can interpolate the result without extra guards.
 */

type DateInput = string | number | Date | null | undefined;

function toDate(input: DateInput): Date | null {
  if (input == null) return null;
  const d = input instanceof Date ? input : new Date(input);
  return isNaN(d.getTime()) ? null : d;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDate(input: DateInput): string {
  const d = toDate(input);
  if (!d) return "";
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()}`;
}

export function formatDateTime(input: DateInput): string {
  const d = toDate(input);
  if (!d) return "";
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}
