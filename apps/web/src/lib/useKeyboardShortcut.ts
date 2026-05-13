"use client";

import { useEffect } from "react";

/**
 * Register a global keydown handler that skips when the user is typing in
 * an input. Shared across episode prev/next, Navbar `/`, the help overlay,
 * and audio-player shortcuts (#702).
 *
 * The handler runs on `keydown`, not `keyup`, so repeats from holding the
 * key autorepeat naturally for seek-style actions.
 */
export interface ShortcutOptions {
  /** Key value from KeyboardEvent.key, e.g. "j", " ", "ArrowLeft", "?". */
  key: string;
  handler: (event: KeyboardEvent) => void;
  /** When true, fire even inside <input> / <textarea> / contenteditable. */
  allowInInputs?: boolean;
  /** When true, require Ctrl (Linux/Win) or Meta (macOS). */
  withCtrlOrMeta?: boolean;
  /** Skip registration when false. Lets callers conditionally enable. */
  enabled?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  // Belt-and-braces: jsdom doesn't always compute isContentEditable from the
  // attribute, and we want a deterministic check for tests as well.
  const attr = target.getAttribute("contenteditable");
  if (attr === "" || attr === "true") return true;
  return false;
}

export function useKeyboardShortcut({
  key,
  handler,
  allowInInputs = false,
  withCtrlOrMeta = false,
  enabled = true,
}: ShortcutOptions): void {
  useEffect(() => {
    if (!enabled) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== key) return;
      if (withCtrlOrMeta && !(event.ctrlKey || event.metaKey)) return;
      if (!allowInInputs && isEditableTarget(event.target)) return;
      handler(event);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [key, handler, allowInInputs, withCtrlOrMeta, enabled]);
}
