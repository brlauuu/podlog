/**
 * A page with unsaved changes can ask to be consulted before an in-app
 * navigation that bypasses the DOM (#1069 follow-up).
 *
 * Link clicks are caught at the document by `useLeaveWarning`, and reload
 * and close by `beforeunload`. A keyboard shortcut calls `router.push`
 * directly, and nothing observes that, so the shortcut handlers ask here
 * first. One guard at a time: only one page is open.
 */
type Guard = () => boolean;

let guard: Guard | null = null;

/** Install (or with null, remove) the page's guard. */
export function setLeaveGuard(next: Guard | null): void {
  guard = next;
}

/**
 * True when navigation to `path` may go ahead. Going to the page already
 * open loses nothing, so it is never questioned.
 */
export function confirmLeave(path: string): boolean {
  if (!guard) return true;
  if (typeof window !== "undefined" && window.location.pathname === path) return true;
  return guard();
}
