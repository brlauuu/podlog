# Episode Page UI Improvement - Design Spec

**Date:** 2026-04-12
**Issue:** #355
**Status:** Approved

## Overview

Reorganize the metadata tags on the episodes list page to display all episode info as inline tags with the reprocess button always visible as the last item in the row.

## UI Changes

### Tag Row Layout

- All metadata displayed as inline tags in a single flex row
- Tags ordered left-to-right: status → date → duration → language → provider → processing time → fireworks cost → reprocess button
- Reprocess button always visible as rightmost item (for all episodes, not just failed)
- Flex wrapping on narrow screens

### Tag Transformations

| Field | Current Display | New Display |
|-------|-----------------|--------------|
| Publishing date | Full date | Full date (unchanged) |
| Duration | e.g., "1h 23m" | Unchanged |
| Transcribe time | "Processed in 1h 23m" | "Transcribed: 45m" |
| Diarize time | Combined with transcribe | "Diarized: 15m" |
| Fireworks STT cost | "$0.0123" | "Fireworks STT: $0.01" with hover tooltip |

### Fireworks STT Tag

- **Visible label**: "Fireworks STT: $X.XX" (rounded to 2 decimals)
- **Hover tooltip** (opaque background):
  - Fireworks audio minutes processed
  - Cost per minute
  - Full precision cost value

### Reprocess Button

- Always visible in tag row (all episodes)
- Right-aligned position
- Icon + text: "↻ Reprocess"
- Same styling as current retry button but available for all episodes

## Technical Notes

- Component: `apps/web/src/components/EpisodesList.tsx`
- Add tooltip component (or use existing)
- Reprocess API endpoint: `/api/episodes/{id}/retry` (existing, works for non-failed episodes)
- No backend changes required

## Acceptance Criteria

1. All episode metadata displayed as inline tags
2. Reprocess button visible for all episodes (not just failed)
3. Fireworks cost shows as "Fireworks STT: $X.XX" with detailed hover
4. Responsive: tags wrap on narrow screens
5. No regression in existing functionality