# Episode Title Filter - Design Spec

**Date:** 2026-04-12
**Issue:** #356
**Status:** Approved

## Overview

Add a search input field to the EpisodesList component to allow users to quickly filter episodes by title. This addresses the need to find specific episodes without scrolling through potentially long lists.

## UI Changes

### Search Input Placement

- Location: Above the sort controls in EpisodesList component
- Full-width input with search icon (lucide-react `Search` icon)
- Uses existing `Input` component from `@/components/ui/input`
- Clear button (×) appears when text is entered (lucide-react `X` icon)

### Search Input Styling

- Border style: `border-input` (matches existing form elements)
- Background: `bg-background`
- Placeholder text: "Search episodes..."
- Left padding for search icon
- Right padding for clear button
- Focus ring: existing `focus-visible:ring-2 focus-visible:ring-ring`

### Filter Behavior

- Real-time filtering as user types (no debounce needed for client-side)
- Case-insensitive partial title match
- Filter applied to displayed episodes list
- Sort order preserved on filtered results

### Stats Display

- When filtered: "Showing X of Y episodes" (where X = filtered count, Y = total)
- When not filtered: Current stats display unchanged
- Clear filter resets to full list

### Empty State

- When search returns no results: "No episodes match your search"
- Displayed in place of episode list
- Keep search input visible (allow user to modify query)

## Technical Design

### State Management

- Add `searchQuery` state (string, initially empty)
- Use `useMemo` to compute `filteredEpisodes` based on search query
- Filtering logic: `episode.title?.toLowerCase().includes(query.toLowerCase())`

### Component Changes

**EpisodesList.tsx:**
- Add `Search` and `X` imports from lucide-react
- Add `Input` import from `@/components/ui/input`
- Add search state and filter logic in `useMemo`
- Render search input above sort controls
- Update StatsBar or add inline stats showing "Showing X of Y"
- Handle empty filtered state

### Performance

- `useMemo` for filtered results prevents unnecessary re-renders
- Filtering happens on already-loaded data (no API calls)
- Minimal impact on render performance

### Accessibility

- Input has proper `aria-label` or visible label
- Clear button has `aria-label="Clear search"`
- Keyboard navigation works (Tab to input, Escape to clear)

## Testing

### Unit Tests

1. **Filter by title (case-insensitive):** Verify "test" matches "Test Episode"
2. **Partial match:** Verify "ep" matches "My Episode"
3. **No results state:** Verify "xyz" shows empty state message
4. **Clear button:** Verify clicking × clears input and shows all episodes
5. **Stats update:** Verify "Showing X of Y" updates correctly when filtering
6. **Empty query:** Verify all episodes shown when query is empty

## Acceptance Criteria

1. Search input visible in EpisodesList
2. Typing filters episodes in real-time (case-insensitive)
3. Partial title matches work
4. "Showing X of Y episodes" displayed when filtered
5. Clear button (×) appears when text entered
6. Clear button resets filter
7. "No episodes match your search" shown when no results
8. Sort controls continue to work on filtered results
9. All existing tests pass
10. New tests cover filtering behavior

## Files to Modify

- `apps/web/src/components/EpisodesList.tsx` - Main implementation
- `apps/web/tests/unit/EpisodesList.test.tsx` - Add filter tests (or create new test file)