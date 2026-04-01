# Speaker Merging — Design Spec

**Date:** 2026-04-01
**Issue:** #94 — Allow for grouping of speakers from the UI
**Status:** Draft

## Goal

Allow users to merge two or more speaker labels within a single episode, reassigning all segments from the source speakers to a chosen target speaker. This fixes pyannote over-segmentation where one real person is split across multiple SPEAKER_XX labels.

## Scope

- Episode-level only (no cross-episode or feed-level merging)
- No undo — user can reprocess the episode if a merge was wrong
- No new database tables — operates on existing `segments` and `speaker_names` tables

## UI Interaction (Option A: Checkbox + Merge Bar)

### Entry Point

A "Merge speakers" text button appears in the SpeakerPanel header, visible whenever there are 2 or more speakers. It sits right-aligned next to the "Speakers" label.

### Merge Mode Flow

1. **Enter merge mode:** User clicks "Merge speakers". The button text changes to "Cancel merge". Checkboxes appear on the top-left corner of each speaker card.

2. **Select speakers:** User clicks cards to toggle selection (minimum 2 required). Selected cards get an indigo outline (`ring-2 ring-indigo-500`).

3. **Merge bar appears:** Once 2+ speakers are selected, a merge bar slides in below the speaker grid. It contains:
   - Text: "Merge N speakers into:"
   - A dropdown defaulting to the selected speaker with the most segments. The dropdown lists only the selected speakers (you merge *into* one of the selected ones). When the user picks a target and clicks Merge, the API receives `source_labels` = all selected speakers *except* the target, and `target_label` = the chosen target.
   - "Merge" button (primary, indigo)
   - "Cancel" text button

4. **Confirm:** User clicks "Merge". A brief loading state on the button, then the panel refreshes with the merged result. Merge mode exits automatically.

5. **Cancel:** User clicks "Cancel" (either in the merge bar or the header). Selection clears, checkboxes disappear, merge bar hides.

### Interaction Details

- Clicking a card in merge mode toggles its checkbox (does not open rename edit)
- The rename click-to-edit is disabled during merge mode
- If the user deselects down to fewer than 2 speakers, the merge bar hides but merge mode stays active
- The merge bar target dropdown only shows selected speakers

## API Design

### Web App Route (Next.js)

**`POST /api/episodes/[id]/speakers/merge`**

Handles the merge directly via SQL since the web app already has direct DB access for speaker operations (consistent with the existing PUT rename endpoint).

Request body:
```json
{
  "source_labels": ["SPEAKER_01", "SPEAKER_02"],
  "target_label": "SPEAKER_00"
}
```

Response (success):
```json
{ "ok": true, "merged_segments": 15 }
```

Response (error):
```json
{ "error": "description" }
```

### Why No Pipeline Endpoint

The existing speaker rename (`PUT /api/episodes/[id]/speakers`) already operates directly on the DB from the Next.js route without going through the pipeline API. Speaker merge follows the same pattern — it's a user-initiated data mutation on `segments` and `speaker_names`, not a pipeline operation.

### SQL Operations (within a single transaction)

1. **Validate** that all source and target labels belong to the episode:
   ```sql
   SELECT DISTINCT speaker_label FROM segments
   WHERE episode_id = $1 AND speaker_label = ANY($2)
   ```
   Verify the count matches the expected labels.

2. **Reassign segments** from source labels to the target label:
   ```sql
   UPDATE segments
   SET speaker_label = $1
   WHERE episode_id = $2 AND speaker_label = ANY($3)
   ```
   Where `$1` = target_label, `$3` = source_labels array.

3. **Delete orphaned speaker_names** for the source labels:
   ```sql
   DELETE FROM speaker_names
   WHERE episode_id = $1 AND speaker_label = ANY($2)
   ```

4. **Ensure target has a speaker_name record.** If the target speaker had a display name, it's already there. If not (unlikely but possible), no action needed — the UI derives the name from the label.

## Validation Rules

| Rule | HTTP Status |
|---|---|
| `source_labels` must be a non-empty array | 400 |
| `target_label` must be a non-empty string | 400 |
| `target_label` must NOT appear in `source_labels` | 400 |
| All labels must belong to the episode (exist in `segments`) | 400 |
| At least 1 source label must be provided | 400 |

## Data Flow

```
User selects SPEAKER_01 + SPEAKER_02, target = SPEAKER_00
         │
         ▼
POST /api/episodes/{id}/speakers/merge
  { source_labels: ["SPEAKER_01", "SPEAKER_02"], target_label: "SPEAKER_00" }
         │
         ▼
BEGIN transaction
  1. Validate all labels exist for this episode
  2. UPDATE segments SET speaker_label = 'SPEAKER_00'
     WHERE episode_id = :id AND speaker_label IN ('SPEAKER_01', 'SPEAKER_02')
  3. DELETE FROM speaker_names
     WHERE episode_id = :id AND speaker_label IN ('SPEAKER_01', 'SPEAKER_02')
COMMIT
         │
         ▼
Return { ok: true, merged_segments: <count> }
         │
         ▼
Frontend calls router.refresh() to reload episode data
SpeakerPanel re-derives speakers from updated segments
Merged speakers disappear, target speaker segment count increases
```

## Component Changes

### `SpeakerPanel.tsx`

- Add `mergeMode` state (boolean)
- Add `selectedLabels` state (Set<string>)
- Add "Merge speakers" / "Cancel merge" toggle button in header
- Pass `mergeMode` and selection handlers to SpeakerCard
- Render MergeBar component when 2+ selected

### New: `MergeBar.tsx`

Small component rendered below the speaker grid:
- Props: `selectedSpeakers: SpeakerInfo[]`, `onMerge: (targetLabel: string) => void`, `onCancel: () => void`
- Contains target dropdown + Merge button + Cancel button
- Handles the loading state during the API call

### `SpeakerCard` (modified within `SpeakerPanel.tsx`)

SpeakerCard stays as an inline component within SpeakerPanel.tsx (matching current structure). New props are added for merge mode:

- When `mergeMode` is true:
  - Show checkbox overlay (top-left corner)
  - onClick toggles selection instead of opening rename
  - Selected cards get indigo ring outline
- When `mergeMode` is false: existing behavior unchanged

### New: `POST /api/episodes/[id]/speakers/merge/route.ts`

- Validate request body
- Run SQL in a transaction (using `pool.connect()` + `BEGIN`/`COMMIT`)
- Return merged segment count

## Testing

### Unit Tests (pipeline — not needed, no pipeline changes)

No pipeline code is modified.

### API Route Test

- Valid merge: 3 speakers, merge 2 into 1, verify segment reassignment and speaker_name cleanup
- Invalid: target in source_labels → 400
- Invalid: labels not belonging to episode → 400
- Invalid: empty source_labels → 400

### Frontend Tests

- MergeBar renders when 2+ speakers selected
- MergeBar hidden when fewer than 2 selected
- Merge button disabled during loading
- Target dropdown defaults to speaker with most segments
- Merge mode toggle shows/hides checkboxes

## Files to Create or Modify

| File | Action |
|---|---|
| `apps/web/src/components/SpeakerPanel.tsx` | Modify — add merge mode state and selection logic |
| `apps/web/src/components/MergeBar.tsx` | Create — merge confirmation bar component |
| `apps/web/src/app/api/episodes/[id]/speakers/merge/route.ts` | Create — POST endpoint for merge |
| `apps/web/src/components/__tests__/MergeBar.test.tsx` | Create — unit tests for MergeBar |
| `apps/web/src/components/__tests__/SpeakerPanel.test.tsx` | Create or modify — merge mode tests |
