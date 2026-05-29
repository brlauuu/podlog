"use client";

import { useEffect, useRef } from "react";

/**
 * Two-key chord (Gmail / GitHub style): press ``prefix``, then within
 * ``timeoutMs`` press one of the keys in ``map`` to trigger that handler
 * (#704).
 *
 * Mirrors useKeyboardShortcut's input-skip behaviour. Any modifier
 * (Ctrl / Meta / Alt) on either keystroke cancels the chord — chords
 * should not collide with browser/system shortcuts.
 */
export interface ChordOptions {
  /** The leader key, e.g. "g". Lowercased before comparison. */
  prefix: string;
  /** Map of second key → handler. Keys are lowercased before comparison. */
  map: Record<string, (event: KeyboardEvent) => void>;
  /** How long to wait for the second key before the chord resets. */
  timeoutMs?: number;
  /** When true, fire even inside <input> / <textarea> / contenteditable. */
  allowInInputs?: boolean;
  /** Skip registration when false. */
  enabled?: boolean;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (target.isContentEditable) return true;
  const attr = target.getAttribute("contenteditable");
  if (attr === "" || attr === "true") return true;
  return false;
}

function hasModifier(event: KeyboardEvent): boolean {
  return event.ctrlKey || event.metaKey || event.altKey;
}

export function useChordShortcut({
  prefix,
  map,
  timeoutMs = 1000,
  allowInInputs = false,
  enabled = true,
}: ChordOptions): void {
  // Refs so the listener can read the latest handler map without re-binding
  // every render. The listener itself only depends on prefix/timeoutMs/etc.
  const mapRef = useRef(map);
  useEffect(() => {
    mapRef.current = map;
  }, [map]);

  useEffect(() => {
    if (!enabled) return;
    const lowerPrefix = prefix.toLowerCase();
    let armed = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    function disarm() {
      armed = false;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (hasModifier(event)) {
        disarm();
        return;
      }
      if (!allowInInputs && isEditableTarget(event.target)) {
        disarm();
        return;
      }
      const k = event.key.toLowerCase();
      if (!armed) {
        if (k === lowerPrefix) {
          armed = true;
          timer = setTimeout(disarm, timeoutMs);
        }
        return;
      }
      // Second keystroke after prefix.
      const handler = mapRef.current[k];
      disarm();
      if (handler) {
        event.preventDefault();
        handler(event);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      disarm();
    };
  }, [prefix, timeoutMs, allowInInputs, enabled]);
}
