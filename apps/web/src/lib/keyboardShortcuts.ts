/**
 * Single source of truth for keyboard-shortcut documentation (#702).
 *
 * Wire-up sites (the actual key handlers) live next to the components that
 * own the relevant state — `useKeyboardShortcut` is the underlying hook.
 * Keep this catalog in lockstep with those handlers; the `?` help overlay
 * renders it verbatim.
 *
 * User-facing prose copy of these bindings lives at
 * `docs/guide/18-keyboard-shortcuts.md` (#730). Update both files when the
 * binding set changes.
 */
export interface ShortcutDoc {
  /** Display string, e.g. "J", "/", "Space", "← / →". */
  keys: string;
  description: string;
}

export interface ShortcutGroup {
  title: string;
  shortcuts: ShortcutDoc[];
}

export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "Navigation",
    shortcuts: [
      { keys: "J", description: "Next episode in this feed (on an episode page)" },
      { keys: "K", description: "Previous episode in this feed (on an episode page)" },
      { keys: "/", description: "Focus the search box" },
    ],
  },
  {
    title: "Audio player",
    shortcuts: [
      { keys: "Space", description: "Play / pause (when audio is loaded)" },
      { keys: "← / →", description: "Seek 10 seconds back / forward" },
    ],
  },
  {
    title: "General",
    shortcuts: [
      { keys: "?", description: "Show this help" },
      { keys: "Esc", description: "Close dialogs and overlays" },
    ],
  },
];
