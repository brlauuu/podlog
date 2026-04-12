# Episode Navigation UI Fix - Design Spec

**Date:** 2026-04-12
**Issue:** #358
**Status:** Approved

## Overview

Redesign the episode page navigation (previous/next episode links) to use button-style elements that meet in the middle and stretch equally, matching the monochromatic style of the landing page buttons.

## UI Changes

### Button Style

Match the landing page search/ask buttons:
- `rounded-lg border border-input bg-background hover:bg-accent`
- `px-5 py-2.5` padding
- `inline-flex items-center gap-2`
- `text-sm font-medium text-foreground`
- `transition-colors`

### Layout Behavior

**When both previous AND next exist:**
- Both buttons have `flex-1` to stretch equally
- Container uses `flex` with `justify-center gap-2`
- Buttons meet in the middle with small gap

**When only previous OR next exists:**
- Single button has natural width (no `flex-1`)
- Button does NOT stretch full width
- Container still centered

### Button Content

**Previous button:**
- Left chevron icon (`<ChevronLeft size={16} />`)
- Episode title (truncated with `truncate` class)
- Direction: flex row (icon left, text right)

**Next button:**
- Episode title (truncated with `truncate` class)
- Right chevron icon (`<ChevronRight size={16} />`)
- Direction: flex row-reverse (text left, icon right) OR justify between

### Edge Cases

- Long episode titles: Use `truncate` class with `max-w-full`
- Missing titles: Show "Previous episode" / "Next episode" as fallback
- Empty state (no prev/next): Don't render navigation section

## Technical Notes

- File: `apps/web/src/app/episodes/[id]/page.tsx`
- Replace existing flexbox navigation (lines ~238-263)
- Keep using Next.js `Link` component for navigation
- Maintain accessibility with proper aria labels
- No backend changes required

## Acceptance Criteria

1. Previous/next buttons use monochromatic button style (rounded-lg, border, hover:bg-accent)
2. When both exist, buttons stretch equally and meet at center
3. When only one exists, button stays at natural width (not stretched)
4. Episode titles are truncated if too long
5. Chevron icons indicate navigation direction
6. No visual regression on mobile or desktop