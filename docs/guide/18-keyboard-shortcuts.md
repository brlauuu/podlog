# Keyboard Shortcuts

Podlog supports a handful of keyboard shortcuts to keep your hands on the keyboard while browsing transcripts, navigating between episodes, and controlling playback.

Press <kbd>?</kbd> from any page to bring up a quick reference overlay that lists every binding below.

## Global navigation chords

Two-key chords jump to top-level pages from anywhere. Press <kbd>G</kbd>, then within one second press the destination key:

| Chord | Goes to |
|---|---|
| <kbd>G</kbd> <kbd>H</kbd> | Home (`/`) |
| <kbd>G</kbd> <kbd>Q</kbd> | Queue (`/queue`) |
| <kbd>G</kbd> <kbd>F</kbd> | Feeds (`/feeds`) |
| <kbd>G</kbd> <kbd>P</kbd> | Podcasts (`/podcasts`) |
| <kbd>G</kbd> <kbd>A</kbd> | Ask (`/ask`) |
| <kbd>G</kbd> <kbd>M</kbd> | Meta-analysis (`/meta-analysis`) |
| <kbd>G</kbd> <kbd>S</kbd> | Settings (`/settings`) |
| <kbd>G</kbd> <kbd>D</kbd> | Docs (`/docs`) |

If you hold a modifier key (<kbd>Ctrl</kbd>, <kbd>Cmd</kbd>, <kbd>Alt</kbd>) the chord is cancelled, so your normal browser shortcuts (<kbd>Cmd</kbd>+<kbd>G</kbd> find-next, etc.) still work.

## Navigation

| Key | Action |
|---|---|
| <kbd>J</kbd> | Previous episode in the same feed (only on an episode page; ordered by published date) |
| <kbd>K</kbd> | Next episode in the same feed (only on an episode page) |
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
