"use client";

/**
 * The floating "Unsaved changes" bar on /settings, and what feeds it (#1069).
 *
 * Save used to sit at the very bottom of the two longest tabs, with nothing
 * on screen to say an edit was still pending. The bar is pinned to the bottom
 * of the window, appears only when something is unsaved, and names the tabs
 * involved -- edits on a tab you have since left are still listed.
 *
 * It is a bar rather than auto-save on purpose. These tabs hold secrets typed
 * a character at a time (bot token, SMTP password, API keys), the bot's
 * allowed list, and provider switches that change how the next episode is
 * processed and what it costs. None of those should be stored half-finished.
 *
 * The Settings page owns the bar. Sections that keep their own draft state
 * (Prompts, Backups) report into it through `useUnsavedChanges`, which does
 * nothing when there is no page above them, so they still render alone.
 */
import { createContext, useContext, useEffect, useRef } from "react";
import { setLeaveGuard } from "@/lib/leaveGuard";

export interface UnsavedEntry {
  /** Tab name, as shown in the tab strip. */
  label: string;
  saving: boolean;
  /** False while the draft is invalid and saving would be refused. */
  canSave: boolean;
  save: () => Promise<void> | void;
  discard: () => void;
}

type Register = (id: string, entry: UnsavedEntry | null) => void;

export const UnsavedChangesContext = createContext<Register | null>(null);

/** Report a section's unsaved state to the page's bar. */
export function useUnsavedChanges(
  id: string,
  state: { label: string; dirty: boolean; saving: boolean; canSave: boolean },
  handlers: { save: () => Promise<void> | void; discard: () => void }
) {
  const register = useContext(UnsavedChangesContext);
  // The bar calls these later, so it must reach the latest closures rather
  // than the ones captured when the section last reported.
  const latest = useRef(handlers);
  useEffect(() => {
    latest.current = handlers;
  });

  const { label, dirty, saving, canSave } = state;
  useEffect(() => {
    if (!register) return;
    register(
      id,
      dirty
        ? {
            label,
            saving,
            canSave,
            save: () => latest.current.save(),
            discard: () => latest.current.discard(),
          }
        : null
    );
  }, [register, id, label, dirty, saving, canSave]);

  useEffect(() => {
    if (!register) return;
    return () => register(id, null);
  }, [register, id]);
}

const LEAVE_MESSAGE = "You have unsaved changes in Settings. Leave without saving?";

/**
 * Warn before unsaved changes are lost by leaving the page.
 *
 * Two paths, because the browser only covers one of them: `beforeunload`
 * catches reload, close and typed addresses, but a click on an in-app link is
 * a client-side navigation that never fires it. Those are caught at the
 * document, ahead of the router; next/link skips a click that is already
 * default-prevented.
 *
 * Keyboard shortcuts that navigate call the router directly, so they ask
 * through `confirmLeave` instead; the guard installed here is what answers.
 *
 * Not covered: the browser's back button.
 */
export function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;

    function onBeforeUnload(e: BeforeUnloadEvent) {
      e.preventDefault();
      e.returnValue = "";
    }

    function onClick(e: MouseEvent) {
      if (e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const target = e.target instanceof Element ? e.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement)) return;
      if (target.target && target.target !== "_self") return;
      if (target.hasAttribute("download")) return;
      const url = new URL(target.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname) return;
      if (!window.confirm(LEAVE_MESSAGE)) {
        e.preventDefault();
        e.stopPropagation();
      }
    }

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    setLeaveGuard(() => window.confirm(LEAVE_MESSAGE));
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      setLeaveGuard(null);
    };
  }, [dirty]);
}

function listLabels(labels: string[]): string {
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
}

export function UnsavedChangesBar({ entries }: { entries: UnsavedEntry[] }) {
  if (entries.length === 0) return null;

  const saving = entries.some((e) => e.saving);
  const blocked = entries.filter((e) => !e.canSave).map((e) => e.label);

  async function saveAll() {
    for (const e of entries) {
      await e.save();
    }
  }

  return (
    <div
      role="region"
      aria-label="Unsaved changes"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background shadow-lg pb-[env(safe-area-inset-bottom)]"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <p className="min-w-0 text-sm" aria-live="polite">
          <span className="font-medium">
            Unsaved changes in {listLabels(entries.map((e) => e.label))}
          </span>
          {blocked.length > 0 && (
            <span className="block text-xs text-destructive">
              Fix {listLabels(blocked)} before saving.
            </span>
          )}
        </p>
        <div className="ml-auto flex shrink-0 gap-2">
          <button
            type="button"
            className="px-4 py-2 max-md:min-h-11 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
            onClick={() => entries.forEach((e) => e.discard())}
            disabled={saving}
          >
            Discard
          </button>
          <button
            type="button"
            className="px-5 py-2 max-md:min-h-11 rounded-md bg-action text-action-foreground text-sm font-medium hover:bg-action/90 disabled:opacity-50"
            onClick={saveAll}
            disabled={saving || blocked.length > 0}
          >
            {saving ? "Saving..." : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
