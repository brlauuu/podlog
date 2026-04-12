# Episode Title Filter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add search input to filter episodes by title in EpisodesList component

**Architecture:** Add search state and filter logic to EpisodesList, use existing Input component with Search/X icons, display filtered stats and empty state

**Tech Stack:** Next.js, React, Tailwind CSS, Lucide icons, shadcn/ui Input component

---

### Task 1: Add search filter to EpisodesList

**Files:**
- Modify: `apps/web/src/components/EpisodesList.tsx:1-15` (imports)
- Modify: `apps/web/src/components/EpisodesList.tsx:233-240` (add search state)
- Modify: `apps/web/src/components/EpisodesList.tsx:255-290` (add filtered episodes memo)
- Modify: `apps/web/src/components/EpisodesList.tsx:311-340` (add search input UI)

- [ ] **Step 1: Update imports**

Add Search and X icons to imports, add Input component import:

```tsx
import {
  AlertTriangle,
  ArrowUpDown,
  ChevronDown,
  ChevronUp,
  Search,
  X,
} from "lucide-react";

import ReprocessButton from "./ReprocessButton";
import { Input } from "@/components/ui/input";
```

- [ ] **Step 2: Add search state**

Add after existing useState declarations (around line 236):

```tsx
  const [searchQuery, setSearchQuery] = useState("");
```

- [ ] **Step 3: Add filtered episodes memo**

Replace the sorted useMemo (lines 255-290) to work with filtered episodes. The filtered and sorted logic should be:

```tsx
  const filteredAndSorted = useMemo(() => {
    // First filter by search query
    const filtered = searchQuery
      ? episodes.filter((ep) =>
          ep.title?.toLowerCase().includes(searchQuery.toLowerCase())
        )
      : episodes;

    // Then sort
    const arr = [...filtered];
    arr.sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case "status":
          cmp = (STATUS_ORDER[a.status] ?? 99) - (STATUS_ORDER[b.status] ?? 99);
          break;
        case "duration_secs":
          cmp = (a.duration_secs ?? 0) - (b.duration_secs ?? 0);
          break;
        case "processed_at": {
          const ta = a.processed_at ? new Date(a.processed_at).getTime() : 0;
          const tb = b.processed_at ? new Date(b.processed_at).getTime() : 0;
          cmp = ta - tb;
          break;
        }
        case "title":
          cmp = (a.title ?? "").localeCompare(b.title ?? "");
          break;
        case "published_at":
        default: {
          const pa = a.published_at ? new Date(a.published_at).getTime() : 0;
          const pb = b.published_at ? new Date(b.published_at).getTime() : 0;
          cmp = pa - pb;
          break;
        }
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return arr;
  }, [episodes, sortKey, sortDir, searchQuery]);
```

- [ ] **Step 4: Update StatsBar to show filtered count**

Replace the StatsBar call (line 313) to pass filtered info:

```tsx
      <StatsBar episodes={episodes} filteredCount={filteredAndSorted.length} searchQuery={searchQuery} />
```

- [ ] **Step 5: Add search input UI**

Add after StatsBar, before sort controls (after line 313, before line 315):

```tsx
      {/* Search input */}
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          type="text"
          placeholder="Search episodes..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-10 pr-10"
          aria-label="Search episodes by title"
        />
        {searchQuery && (
          <button
            onClick={() => setSearchQuery("")}
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            aria-label="Clear search"
          >
            <X size={16} />
          </button>
        )}
      </div>
```

- [ ] **Step 6: Replace sorted with filteredAndSorted in render**

Change line 338 from `{sorted.map((ep) => {` to:

```tsx
      <div className="space-y-2">
        {filteredAndSorted.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            No episodes match your search
          </p>
        ) : (
          filteredAndSorted.map((ep) => {
```

And close the conditional at the end (after line 489, before `</div>` closes):

```tsx
          })
        )}
      </div>
```

- [ ] **Step 7: Update StatsBar component**

Modify the StatsBar component (around line 187) to accept and display filtered info:

```tsx
function StatsBar({ 
  episodes, 
  filteredCount, 
  searchQuery 
}: { 
  episodes: EnrichedEpisode[]; 
  filteredCount: number;
  searchQuery: string;
}) {
  const counts = useMemo(() => {
    const c = { total: episodes.length, done: 0, processing: 0, failed: 0, pending: 0 };
    for (const ep of episodes) {
      if (ep.status === "done") c.done++;
      else if (ep.status === "failed") c.failed++;
      else if (ep.status === "pending") c.pending++;
      else c.processing++;
    }
    return c;
  }, [episodes]);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
      {searchQuery ? (
        <span className="font-medium text-foreground">
          Showing {filteredCount} of {counts.total} episodes
        </span>
      ) : (
        <span className="font-medium text-foreground">{counts.total} episodes</span>
      )}
      <span className="text-muted-foreground/50">·</span>
      <span>{counts.done} transcribed</span>
      {counts.processing > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-blue-600 dark:text-blue-400">{counts.processing} processing</span>
        </>
      )}
      {counts.failed > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span className="text-red-600 dark:text-red-400">{counts.failed} failed</span>
        </>
      )}
      {counts.pending > 0 && (
        <>
          <span className="text-muted-foreground/50">·</span>
          <span>{counts.pending} pending</span>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 8: Run typecheck**

```bash
cd apps/web && npm run typecheck
```

Expected: No errors

- [ ] **Step 9: Run linter**

```bash
cd apps/web && npm run lint
```

Expected: No new errors

- [ ] **Step 10: Run tests**

```bash
cd apps/web && npm run test
```

Expected: All tests pass (currently 143)

- [ ] **Step 11: Commit**

```bash
git add apps/web/src/components/EpisodesList.tsx
git commit -m "feat: add episode title search filter (#356)"
```

---

### Task 2: Add unit tests for search filter

**Files:**
- Modify: `apps/web/tests/unit/EpisodesList.test.tsx`

- [ ] **Step 1: Add test for case-insensitive filtering**

Add after the existing tests (around line 156):

```tsx
  it("filters episodes by title case-insensitively", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search for "test" should match "Test Episode One"
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Should show only "Test Episode One"
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();
  });

  it("filters episodes by partial title match", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search for "ep" should match both episodes
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "ep" } });

    // Should show both episodes
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();

    // Search for "one" should match only first episode
    fireEvent.change(searchInput, { target: { value: "one" } });
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();
  });

  it("shows empty state when no episodes match search", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search for something that doesn't match
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "xyz" } });

    // Should show empty state message
    expect(screen.getByText("No episodes match your search")).toBeInTheDocument();
    expect(screen.queryByText("Test Episode One")).not.toBeInTheDocument();
  });

  it("clear button resets search and shows all episodes", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Search to filter
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Only first episode should be visible
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.queryByText("Another Episode")).not.toBeInTheDocument();

    // Click clear button
    const clearButton = screen.getByLabelText("Clear search");
    fireEvent.click(clearButton);

    // Both episodes should be visible again
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();
  });

  it("shows filtered count in stats bar", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Initially shows total count
    expect(screen.getByText(/2 episodes/)).toBeInTheDocument();

    // Search to filter
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });

    // Should show "Showing X of Y" format
    expect(screen.getByText(/Showing 1 of 2 episodes/)).toBeInTheDocument();
  });

  it("shows all episodes when search query is empty", () => {
    const mockEpisodes: EnrichedEpisode[] = [
      {
        id: "ep-1",
        title: "Test Episode One",
        published_at: "2026-04-01T10:00:00.000Z",
        processed_at: "2026-04-01T11:00:00.000Z",
        duration_secs: 3600,
        language: "en",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 120,
        diarize_duration_secs: 60,
        inference_provider_used: "fireworks",
        fireworks_audio_minutes: 60,
        fireworks_stt_cost_usd: 0.0123,
        speaker_count: 2,
        speaker_name_tags: [],
      },
      {
        id: "ep-2",
        title: "Another Episode",
        published_at: "2026-04-02T10:00:00.000Z",
        processed_at: null,
        duration_secs: 1800,
        language: "de",
        status: "done",
        has_diarization: true,
        diarization_error: null,
        error_class: null,
        error_message: null,
        retry_count: 0,
        retry_max: 3,
        transcribe_duration_secs: 90,
        diarize_duration_secs: 45,
        inference_provider_used: "local",
        fireworks_audio_minutes: null,
        fireworks_stt_cost_usd: null,
        speaker_count: 3,
        speaker_name_tags: [],
      },
    ];

    render(<EpisodesList episodes={mockEpisodes} feedId="feed-1" />);

    // Both episodes visible initially
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();

    // Type and then clear
    const searchInput = screen.getByLabelText("Search episodes by title");
    fireEvent.change(searchInput, { target: { value: "test" } });
    fireEvent.change(searchInput, { target: { value: "" } });

    // Both episodes should still be visible
    expect(screen.getByText("Test Episode One")).toBeInTheDocument();
    expect(screen.getByText("Another Episode")).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run tests**

```bash
cd apps/web && npm run test -- EpisodesList
```

Expected: All 11 tests pass (6 existing + 5 new)

- [ ] **Step 3: Run full test suite**

```bash
cd apps/web && npm run test
```

Expected: All tests pass (143 existing + 5 new = 148)

- [ ] **Step 4: Commit**

```bash
git add apps/web/tests/unit/EpisodesList.test.tsx
git commit -m "test: add episode search filter tests (#356)"
```

---

## Spec Coverage Check

- ✅ Search input with Search icon
- ✅ Clear button (X) when text entered
- ✅ Case-insensitive filtering
- ✅ Partial title match
- ✅ Real-time filtering
- ✅ "Showing X of Y episodes" stats
- ✅ Empty state message
- ✅ Sort controls work on filtered results
- ✅ All existing tests pass
- ✅ New tests cover filtering behavior

## Placeholder Scan

- No "TBD", "TODO", or incomplete sections
- No vague requirements
- Exact code provided for all changes
- Exact commands with expected output