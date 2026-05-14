# Keyboard Shortcuts

Podlog supports a handful of keyboard shortcuts to keep your hands on the keyboard while browsing transcripts, navigating between episodes, and controlling playback.

Press <kbd>?</kbd> from any page to bring up a quick reference overlay that lists every binding below.

## Navigation

| Key | Action |
|---|---|
| <kbd>J</kbd> | Next episode in the same feed (only on an episode page; ordered by published date) |
| <kbd>K</kbd> | Previous episode in the same feed (only on an episode page) |
| <kbd>/</kbd> | Focus the nearest search input on the page. If no search input is present, jumps to `/search` |

## Audio player

These work whenever audio is loaded in the persistent player at the bottom of the screen.

| Key | Action |
|---|---|
| <kbd>Space</kbd> | Play / pause the current track |
| <kbd>←</kbd> | Seek 10 seconds back |
| <kbd>→</kbd> | Seek 10 seconds forward |

When no audio is loaded, <kbd>Space</kbd> falls back to the browser's default page-scroll behavior — Podlog only intercepts it while the player has a track to control.

## General

| Key | Action |
|---|---|
| <kbd>?</kbd> | Show or hide the keyboard-shortcuts help overlay |
| <kbd>Esc</kbd> | Close dialogs and overlays |

## Skipping shortcuts while typing

Shortcuts are deliberately skipped while you are typing in:

- Any `<input>`, `<textarea>`, or `<select>` element
- Any element with `contenteditable="true"`

This means you can type a `?` into the search bar or paste text without accidentally toggling an overlay or seeking the player. The one exception is the help overlay's own <kbd>?</kbd> binding, which is always live so you can pull it up from anywhere.

## Why some keys are not bound

A few keys you might expect have intentionally been left alone:

- <kbd>↑</kbd> / <kbd>↓</kbd> stay on the browser's scroll behavior — they would conflict with reading long transcripts.
- Letter keys outside <kbd>J</kbd>/<kbd>K</kbd> are unbound so the browser's find-in-page (<kbd>Ctrl</kbd>+<kbd>F</kbd>) and similar tools work normally.
- <kbd>Enter</kbd> belongs to whatever form you are in (search, settings, Ask).

If you have suggestions for additional bindings, open an issue on the repository.
