# First-Run Wizard Design Spec

**Issue:** #108
**Date:** 2026-04-03
**Scope:** In-app first-run wizard (3 screens) with re-launch from navbar help menu. No backend changes beyond a new `system_state` key.

---

## Overview

A lightweight setup wizard shown as a full-screen overlay dialog on first visit. Walks new users through system health verification, adding their first feed, and discovering key pages. Dismissible at any screen. Re-launchable from a "?" help icon in the navbar.

## Architecture

- **Frontend only** — a single `SetupWizard` React component using the existing Radix Dialog
- **State tracking** — `wizard_completed` key in the existing `system_state` table (pipeline DB)
- **No new backend endpoints** — reads health from existing `/api/pipeline/health`, adds feeds via existing `/api/feeds` proxy, reads/writes wizard state via a new `/api/wizard/status` proxy route (thin wrapper around `system_state`)
- **Re-launch** — "?" help icon + Radix DropdownMenu in the Navbar, right-aligned next to the existing theme toggle

## Screens

### Screen 1: Welcome + System Health

**Content:**
- Title: "Welcome to Podlog"
- Subtitle: "Self-hosted podcast transcription & search. Everything runs locally — your data never leaves this machine."
- System status panel showing three services:
  - Database — Connected / Degraded
  - Pipeline API — Healthy / Degraded
  - Worker — Ready / Downloading models... (with progress bar)
- Progress bar and "first run only" note shown only while worker status is `WARMING_UP`

**Behavior:**
- Health polls every 3 seconds via React Query (`/api/pipeline/health`)
- Green checkmarks animate in as services come online
- "Next" button always enabled — user can proceed while worker warms up
- "Skip wizard" button on every screen — marks `wizard_completed` and closes

**Data source:** Existing `GET /api/pipeline/health` returns `{ status, services: [{ name, status }] }`. Worker status is `WARMING_UP` until `system_state.prewarm_done = "1"`.

### Screen 2: Add Your First Feed

**Content:**
- Title: "Add Your First Podcast"
- Subtitle recommending Test mode for first feed
- Feed URL text input
- Mode selector: three cards (Test, Selective, Full) — Test pre-selected with blue highlight
- Inline error display below URL input for invalid URL or network errors
- When Selective mode chosen: scrollable episode list with checkboxes (fetched via `/api/feeds/preview`)

**Behavior:**
- Test mode pre-selected as recommended default
- Selecting Selective triggers feed preview fetch, shows episode picker
- "Add Feed" / "Add N Episodes" submits via existing `POST /api/feeds` proxy
- "Skip — I'll explore first" advances to Screen 3 without adding
- "Back" returns to Screen 1

**Data sources:**
- `POST /api/feeds/preview` — fetches episode list for selective mode
- `POST /api/feeds` — creates feed with selected mode and episodes

### Screen 3: You're All Set / Ready When You Are

**Two variants based on whether a feed was added:**

**Feed added variant:**
- Title: "You're All Set!"
- Subtitle mentioning processing time estimate (30-90 min)
- Link cards: Search, Queue, Add More Feeds, User Guide

**Feed skipped variant:**
- Title: "Ready When You Are"
- Subtitle: "No feeds added yet"
- Link cards: Add Your First Feed (highlighted with blue border), Search, Queue, User Guide

**Shared elements:**
- "Don't show this wizard on next visit" checkbox — controls auto-show behavior
- "Get Started" button — closes wizard, navigates to Queue (if feed added) or home (if skipped)
- Link cards are text-only (no emojis), each with title, description, and arrow

**Behavior:**
- "Don't show this wizard on next visit" checked: sets `wizard_completed = "1"` in `system_state`
- "Don't show this wizard on next visit" unchecked: does not set the key (wizard shows again next visit)
- "Get Started" always closes the wizard
- Link card clicks close wizard and navigate via Next.js router

## Navbar Help Icon

**Placement:** Right side of the navbar, next to the existing light/dark theme toggle. Nav links (Search, Podcasts, Queue, Notifications) stay left-aligned. Theme toggle and help icon are right-aligned together.

**Component:** Circular "?" button (28px, border, muted text) using `@radix-ui/react-dropdown-menu` (already installed).

**Dropdown items:**
1. **Setup Wizard** — opens the wizard overlay (same 3-screen flow regardless of completion state)
2. **User Guide** — external link to `docs/guide/` on GitHub

## Wizard State Management

**Key:** `wizard_completed` in `system_state` table.

**API route:** `GET/PUT /api/wizard/status` (Next.js proxy route)
- `GET` → reads `system_state` where `key = 'wizard_completed'`, returns `{ completed: boolean }`
- `PUT { completed: true }` → upserts `wizard_completed = "1"` in `system_state`
- `PUT { completed: false }` → deletes the `wizard_completed` row

**Auto-show logic (in `layout.tsx` or a provider):**
1. On app mount, fetch `GET /api/wizard/status`
2. If `completed` is `false` (key not set), auto-open the wizard
3. If `completed` is `true`, do nothing — user can still re-launch from help menu

**Re-launch from help menu:** Always opens the wizard regardless of `wizard_completed` state. The wizard flow is identical for first-run and re-launch.

## Component Structure

```
apps/web/src/
├── components/
│   ├── SetupWizard.tsx          # Main wizard: Dialog + 3 screen components
│   ├── WizardHealthCheck.tsx    # Screen 1: health polling + status display
│   ├── WizardAddFeed.tsx        # Screen 2: URL input, mode picker, episode preview
│   ├── WizardComplete.tsx       # Screen 3: links + don't-show checkbox
│   ├── HelpMenu.tsx             # "?" button + dropdown (Setup Wizard, User Guide)
│   └── Navbar.tsx               # Modified: add HelpMenu next to theme toggle
├── app/api/wizard/
│   └── status/route.ts          # GET/PUT proxy for wizard_completed state
└── lib/
    (no new files — uses existing db.ts pool)
```

## Data Flow

```
First visit:
  layout mounts → GET /api/wizard/status → { completed: false }
  → auto-open SetupWizard

Screen 1:
  React Query polls GET /api/pipeline/health every 3s
  → updates service status display

Screen 2:
  User enters URL → selects mode
  If selective: POST /api/feeds/preview → show episode list
  On submit: POST /api/feeds → feed created, advance to Screen 3

Screen 3:
  "Don't show again" checked + "Get Started" clicked
  → PUT /api/wizard/status { completed: true }
  → close dialog, navigate

Re-launch:
  Help menu click → open SetupWizard (same flow, same 3 screens)
```

## Error Handling

- **Health check fails entirely:** Show all services as "Unknown" with muted badges. "Next" still works.
- **Feed URL invalid:** Inline red error below input: "Invalid RSS feed URL"
- **Feed preview fails:** Inline error: "Couldn't fetch episodes — check the URL and try again"
- **Feed creation fails:** Inline error with server message
- **Wizard status fetch fails:** Default to showing the wizard (fail-open for first-run experience)

## Testing

- **SetupWizard:** Auto-opens when status is not completed, doesn't open when completed, re-opens from help menu
- **WizardHealthCheck:** Renders correct status badges for healthy/warming/degraded states
- **WizardAddFeed:** Mode selection highlights, selective mode shows episode picker, submit calls API
- **WizardComplete:** Correct variant shown based on feed-added state, checkbox controls PUT call
- **HelpMenu:** Dropdown opens/closes, "Setup Wizard" triggers wizard open
- **API route:** GET returns correct boolean, PUT upserts/deletes key

## Out of Scope

- Notification setup in the wizard (users can find it in the navbar)
- Onboarding tooltips or feature highlights outside the wizard
- Wizard analytics or completion tracking beyond the boolean
- Wizard content localization
