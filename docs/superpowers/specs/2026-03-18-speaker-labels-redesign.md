# Speaker Labels Redesign: Chat Bubbles + Speaker Panel

**Date:** 2026-03-18
**Status:** Approved

## Problem

The current transcript view makes it hard to track who is speaking. Speaker labels only appear on the first segment of a new speaker turn, and raw `SPEAKER_00`/`SPEAKER_01` labels are meaningless when no name has been inferred or assigned. The renaming UX (a hover-revealed pencil icon on the label) is not discoverable.

## Design

### Speaker Color Palette

A fixed palette assigned by speaker slot order:

| Slot | Color | Tailwind | Hex |
|---|---|---|---|
| SPEAKER_00 | Blue | `blue-500` | `#3b82f6` |
| SPEAKER_01 | Amber | `amber-500` | `#f59e0b` |
| SPEAKER_02 | Emerald | `emerald-500` | `#10b981` |
| SPEAKER_03 | Purple | `purple-500` | `#a855f7` |
| SPEAKER_04+ | Rose | `rose-500` | `#f43f5e` |

Colors are deterministic within an episode — same `speaker_label` always maps to the same color. The mapping is derived from the slot index: parse the numeric suffix from `SPEAKER_NN` via regex `/SPEAKER_(\d+)/`, use the captured number as the palette index. Labels that don't match this pattern get the last color (Rose) as a fallback. Episodes with 5+ speakers will share Rose for slots 4+ — acceptable given typical podcast formats (2-4 speakers).

### Speaker Panel (new component: `SpeakerPanel.tsx`)

A grid of mini cards rendered above the transcript. Only shown when `hasDiarization` is true and at least one segment has a `speaker_label`.

Each card shows:
- **Color avatar circle** with initials (first letter of each word in display name, or `S0`/`S1` for raw labels)
- **Display name** (or `SPEAKER_NN` fallback)
- **Role badge**: "Host" (if slot 0) or "Guest" (if slot 1+), only shown when display name is not the raw label (i.e., a name has been inferred or assigned). This is a heuristic — the first speaker detected by pyannote is assumed to be the host.
- **Inference badge**: "Inferred" (violet) if `inferred && !confirmed_by_user`, or "Confirmed" (green checkmark) if `confirmed_by_user`. Replaces the per-segment badges from the current transcript view.
- **Segment count** (e.g., "42 segments")

**Editing flow:**
1. User clicks a speaker card
2. The display name becomes an inline text input (autofocused, pre-filled with current name)
3. Enter saves, Escape cancels
4. On save: `PUT /api/episodes/{episodeId}/speakers` with `{ speaker_label, display_name }` (existing endpoint). Input is disabled and shows a brief saving indicator during the request.
5. On success: local state updates all segments with that `speaker_label`: sets `display_name` to the new name, `inferred` to `false`, `confirmed_by_user` to `true`. Panel card and all transcript bubbles reflect the change immediately. The inference badge on the card updates to "Confirmed".
6. On failure: input reverts, no state change

The panel derives its speaker list from the segments data — it extracts unique `speaker_label` values, their display names, and counts. No additional API call needed.

### Transcript View (rewrite of `TranscriptView.tsx`)

Rewrite the segment rendering to a chat-bubble layout:

**On speaker change** (first segment of a new speaker turn):
- **Avatar circle** (32px, colored, with initials) in the left gutter
- **Speaker name** in their assigned color, bold
- **Timestamp** as a clickable button (plays audio from that point — existing behavior)
- **Text** in a tinted bubble (`bg-{color}/10`, rounded, with speaker-side flat corner)

**Consecutive segments** (same speaker as previous):
- No avatar
- Smaller tinted bubble with timestamp inside
- Visually grouped with the speaker's turn above (small gap, same color tint)

**Segments without diarization** (`speaker_label === null`):
- Plain text with timestamp, no avatar, no color tint
- Same as today's rendering for undiarized segments

**Preserved behaviors:**
- Hash-based highlight scrolling (`#t-{seconds}`)
- Click-to-play on timestamps (via `useAudioPlayer`)
- Inference badges — moved to speaker panel cards (not shown per-segment in the transcript)

### Component Changes

| Component | Action | Notes |
|---|---|---|
| `TranscriptSection.tsx` | Create | Client wrapper owning segments state, coordinates panel + transcript + export |
| `SpeakerPanel.tsx` | Create | Mini cards grid with inline editing |
| `TranscriptView.tsx` | Rewrite | Chat bubble layout with speaker colors |
| `SpeakerLabel.tsx` | Delete | Replaced by SpeakerPanel editing |
| `episodes/[id]/page.tsx` | Modify | Replace direct TranscriptView/SpeakerPanel/Export rendering with single `TranscriptSection` |

### TranscriptSection.tsx (new client wrapper)

A `"use client"` component that owns the `segments` state and coordinates the panel, transcript, and export button. Props:

```typescript
interface TranscriptSectionProps {
  episodeId: string;
  hasDiarization: boolean;
  status: string;
  segments: Segment[];           // Initial segments from server
  audioLocalPath: string | null;
  episodeTitle: string | null;
  feedTitle: string | null;
  // Export-related props forwarded to TranscriptExportButton
  publishedAt: string | null;
  durationSecs: number | null;
  description: string | null;
  feedUrl: string | null;
  feedWebsiteUrl: string | null;
  feedDescription: string | null;
  audioUrl: string | null;
  guid: string | null;
}
```

Renders:
1. Transcript header ("Transcript" + `TranscriptExportButton` with current segments state)
2. `SpeakerPanel` (if `hasDiarization`)
3. `TranscriptView`

On rename callback: updates segments state (`display_name`, `inferred: false`, `confirmed_by_user: true` for all segments with the renamed `speaker_label`). All children re-render with fresh data, including the export button.

**Note on `path` import:** The current `TranscriptView.tsx` imports Node.js `path` module for `path.basename()`. The rewrite must replace this with `audioLocalPath.split('/').pop()` since this is a client component.

### Data Flow

```
Episode Page (server component)
  └─ getSegments() SQL query (unchanged)
  └─ Renders TranscriptSection (client boundary)
       └─ Owns segments[] state
       └─ Renders:
            ├─ Transcript header + TranscriptExportButton (receives live segments state)
            ├─ SpeakerPanel (client component)
            │    ├─ Derives speaker list from segments prop
            │    ├─ Renders mini cards grid with inference badges
            │    └─ On rename: PUT /api/episodes/{id}/speakers → calls onRenamed callback
            │
            └─ TranscriptView (client component)
                 ├─ Receives segments + speaker color map
                 └─ Renders chat bubbles with speaker colors

On rename: TranscriptSection updates segments state (display_name, inferred, confirmed_by_user).
All children (panel, transcript, export) re-render with the updated data.
```

### What Doesn't Change

- **Backend**: No API, DB, or pipeline changes. The existing `PUT /api/episodes/{id}/speakers` endpoint handles everything.
- **Search results**: Already use `COALESCE(sn.display_name, s.speaker_label)` — picks up renamed speakers on next search.
- **Transcript export**: Already uses `display_name ?? speaker_label`. Now receives segments from `TranscriptSection`'s live state, so in-session renames are reflected immediately in exports.
- **Segment SQL query**: Unchanged — already JOINs speaker_names for display_name, inferred, confirmed_by_user.
