# PRD-02: Search Web Application

**Project:** PodSearch — Self-hosted Podcast Transcription & Search  
**Document:** PRD-02 — Search Web Application  
**Version:** 1.1  
**Status:** Draft  
**Author:** Claude (generated from user specification)  
**Changelog:** v1.1 — Dark mode added (OQ-04 resolved), persistent audio player added (OQ-03 resolved), search result grouping deferred to V1 (OQ-01 resolved), pagination count query specified (gap resolved), path traversal mitigation for audio serving added (gap resolved), diarization failure surfaced in all three UI locations, queue dashboard updated with retry state and error classification display, model warm-up banner added.

---

## 1. Problem Statement

Once podcast transcripts are stored in the database (PRD-01), users need a simple, fast interface to search across them. The core job-to-be-done is: *"I want to find the moment in a podcast where they discussed X, and go straight to that point in the audio."* The web app is the user-facing half of PodSearch — it is independent of the ingestion pipeline and reads from the same database.

---

## 2. Goals & Non-Goals

### Goals
- Provide a fast, simple full-text search across all processed podcast transcripts
- Display results with speaker labels, timestamps, and surrounding context
- Generate deep-link URLs that navigate to the exact timestamp in an episode's audio
- Show per-podcast and per-episode browsing (not just global search)
- Allow users to rename speaker labels (SPEAKER_00 → "Alice") per episode
- Surface basic queue/ingestion management (add feeds, view job status) in the same UI
- Support dark mode
- Persistent audio player that continues playing across page navigation
- Run locally, no authentication in V1

### Non-Goals (V1)
- User accounts or authentication (deferred to V2)
- Semantic / vector search (deferred to V2)
- Mobile app (web-only, but responsive)
- Public deployment (local only in V1)
- Search result grouping by episode (deferred to V1)

---

## 3. Users & Context

**Primary user:** A single person running PodSearch locally. They are technical but want a clean UI for daily use, not a developer console. The app should feel like a personal tool — fast, dense with information, no unnecessary chrome.

**Usage pattern:** Open the app, type a search query, scan results, click a timestamp link to open the episode at the right moment.

---

## 4. User Stories

| ID | Story |
|----|-------|
| US-01 | As a user, I can type a keyword or phrase and see all transcript segments across all podcasts that contain it, sorted by relevance. |
| US-02 | As a user, each search result shows: the episode title, podcast name, speaker label, timestamp, and a snippet of the surrounding text with my search term highlighted. |
| US-03 | As a user, I can click a timestamp on a search result and be taken directly to that moment in the episode — either via a deep link to the original remote URL, or via the local archived audio player if available. |
| US-04 | As a user, I can filter search results to a specific podcast or episode. |
| US-05 | As a user, I can browse all podcasts and see their episodes listed with processing status. |
| US-06 | As a user, I can add a new RSS feed URL from within the web app. |
| US-07 | As a user, I can see the current ingestion queue with job status, progress, and error messages. |
| US-08 | As a user, I can retry a failed ingestion job. |
| US-09 | As a user, I can rename speaker labels for a specific episode (e.g. SPEAKER_00 → "John"). |
| US-10 | As a user, the app works well on both desktop and mobile screen sizes. |
| US-11 | As a user, I can switch between light and dark mode, and the app remembers my preference. |
| US-12 | As a user, audio I start playing continues across page navigation without interruption. |
| US-13 | As a user, I can see at a glance that an episode's transcript has no speaker labels due to a diarization failure, on the episode list, the episode page, and in search results. |

---

## 5. Functional Requirements

### 5.1 Global Search

- A search bar is the primary element on the homepage.
- Search queries against the `segments` table using PostgreSQL full-text search (`to_tsvector` / `ts_query`).
- Results include: matched segment text, surrounding context (1–2 adjacent segments), episode title, podcast name, speaker label (or custom display name if set), timestamp, and diarization warning badge if `has_diarization = false` on the parent episode.
- Results are ranked by PostgreSQL `ts_rank`.
- **Pagination:** 20 results per page with prev/next navigation. The total result count is fetched via a companion `COUNT(*)` query run alongside the main search query:
  ```sql
  SELECT COUNT(*) FROM segments s
  JOIN episodes e ON s.episode_id = e.id
  JOIN feeds f ON e.feed_id = f.id,
    plainto_tsquery('english', $1) AS query
  WHERE to_tsvector('english', s.text) @@ query
    AND ($2::uuid IS NULL OR f.id = $2);
  ```
  This count is used to display "Page 1 of N" and to disable the Next button on the last page.
- Search is scoped to "all podcasts" by default; a dropdown allows filtering to a specific podcast.
- **Result grouping:** Not implemented in MVP — results are ordered purely by `ts_rank`. Grouping by episode (top N segments per episode) is deferred to V1.
- Empty state: friendly message when no results are found, with suggestions (check spelling, try broader terms).
- Loading state: skeleton UI while waiting for results.

### 5.2 Timestamp Deep Links

**Remote URL deep link (primary):**  
For most podcast players, appending `#t=<seconds>` to the episode's audio URL causes the player to seek to that position. The UI generates a link like:
```
https://media.example.com/episode.mp3#t=1234
```
This is displayed as a clickable timestamp badge on each result. Clicking it opens the URL in a new tab.

**Note:** `#t=` works reliably with HTML5 `<audio>` elements and some podcast players. It does not work with all third-party podcast apps. This limitation is documented in the UI via a tooltip: *"Opens in browser audio player. May not seek in all podcast apps."*

**Local audio player (when archived file exists):**  
If the episode has a local archived audio file, the result also shows a "Play locally" button. Clicking it loads the episode into the **persistent global audio player** (see §5.7) pre-seeked to the timestamp.

The backend serves archived audio files via a Next.js API route: `GET /api/audio/[episodeId]/[filename]`.

**Security:** The audio serving route validates that the resolved file path is strictly within `/data/audio/archive/` before serving. If the resolved path escapes this directory (path traversal attempt), the route returns HTTP 400. The `filename` parameter is treated as a basename only — any path separators are stripped before path resolution.

### 5.3 Episode & Podcast Browsing

- `/podcasts` — grid of all registered podcasts with cover art, episode count, last processed date.
- `/podcasts/{id}` — episode list for a podcast, sorted by published date descending, with processing status badge per episode. Episodes with `has_diarization = false` display a "No speaker labels" badge alongside their status.
- `/episodes/{id}` — full transcript view for a single episode: scrollable list of segments, each showing timestamp, speaker label, and text. Includes a search-within-episode input. If `has_diarization = false`, a banner at the top of the page reads: *"Speaker labels unavailable — diarization failed: [reason]"* with a muted style to avoid alarming the user.

### 5.4 Speaker Label Management

- On the `/episodes/{id}` page, each unique speaker label has an edit (pencil) icon.
- Clicking it opens an inline text input to rename the speaker. Saving writes to the `speaker_names` table.
- The rename is episode-scoped (renaming "SPEAKER_00" on Episode A does not affect Episode B).
- The search results and transcript views use display names wherever available, falling back to `SPEAKER_N`.
- If `has_diarization = false`, speaker labels are absent. The edit icon is hidden and the banner (§5.3) explains why.

### 5.5 Feed Management

- `/feeds` — list of all registered RSS feeds with title, URL, last polled date, episode count.
- A "+ Add Feed" button opens a modal with a text input for the RSS URL. On submit, `POST /api/feeds` is called. The UI shows a loading state and confirms success or surfaces an error (e.g. "invalid RSS feed").
- A "Poll now" button on each feed triggers an immediate re-poll outside the 24-hour schedule.
- A "Remove feed" option removes the feed. A confirmation dialog asks whether to also delete all associated episodes and transcripts.

### 5.6 Queue Dashboard

- `/queue` — shows current job queue state: active job (with live progress bar), pending jobs (count and list), failed jobs (with error message and retry button).
- Progress for the active job is fetched by polling `GET /api/queue` every 5 seconds.
- **Worker warm-up banner:** When `GET /api/health` returns `{ status: "WARMING_UP" }`, the queue page displays a top banner: *"Worker is initializing — downloading models (~3 GB). Jobs will begin processing once complete."* The banner dismisses automatically when warm-up finishes.
- **Retry state display:** When a job is in auto-retry, the active job card shows: `"Retrying (2/3) — HTTP 403 — Next attempt in 2m"`. The progress bar is replaced with a retry countdown during the backoff period.
- **Error classification display:** Failed jobs display their `error_class` as a human-readable label:
  - `TRANSIENT_NETWORK` → "Network error"
  - `HTTP_ACCESS` → "Access error (HTTP NNN)"
  - `DISK_FULL` → "Disk full — free space and retry"
  - `OOM` → "Out of memory — check hardware requirements"
  - `SYSTEM_ERROR` → "Unexpected error"
- Failed jobs show a collapsible error detail panel with the full traceback.
- A "Retry" button on failed jobs calls `POST /api/queue/{task_id}/retry`. The button is disabled (greyed out with tooltip "Cannot retry — resolve the underlying issue first") for `DISK_FULL` and `OOM` errors, since these require user action before retrying.
- A "Retry" button is shown for `TRANSIENT_NETWORK`, `HTTP_ACCESS`, and `SYSTEM_ERROR` failures.

### 5.7 Persistent Audio Player

A global audio player bar is rendered in the root layout, fixed to the bottom of the screen. It persists across all page navigation.

- **Trigger:** Clicking any "Play locally" button loads the episode and timestamp into the global player via a React context (`AudioPlayerContext`). The player begins playback immediately at the specified timestamp.
- **Player controls:** Play/pause, seek bar, current time / duration, volume, episode title and podcast name.
- **State:** The player holds the currently loaded episode in React context. It is not persisted to `localStorage` (unsupported in this environment) — if the user reloads the page, the player resets.
- **Minimise/expand:** The player bar can be collapsed to show only the episode title and play/pause control, freeing vertical space on mobile.
- **Implementation:** The player bar is a fixed-position component in the Next.js root layout (`app/layout.tsx`). `AudioPlayerContext` is a React context provider wrapping the layout, allowing any page or component to call `playEpisode(episodeId, filename, startTimeSecs)` to load a new episode.

### 5.8 Dark Mode

- Dark mode is implemented using Tailwind's `dark:` variant with the `class` strategy (toggled by adding/removing `dark` class on `<html>`).
- The user's preference is stored in `localStorage` under the key `podsearch-theme`.
- On first load, the app checks `localStorage` first; if absent, it respects the OS-level `prefers-color-scheme` media query.
- A toggle button (sun/moon icon) in the top navigation bar switches modes.
- shadcn/ui components support dark mode natively via CSS variables — no additional configuration required beyond enabling the `class` strategy in `tailwind.config.ts`.

### 5.9 Navigation

Top navigation bar (fixed):
- **PodSearch** logo/wordmark (links to `/`)
- **Search** (homepage)
- **Podcasts**
- **Queue** (with a badge showing active + pending count)
- **Settings** (placeholder in V1, expanded in V2)
- **Dark mode toggle** (sun/moon icon, right-aligned)

---

## 6. Non-Functional Requirements

| Concern | Requirement |
|---------|-------------|
| Performance | Search results return in <500ms for up to 100k segments (PostgreSQL FTS with GIN index is sufficient) |
| Accessibility | Semantic HTML, keyboard-navigable search results, ARIA labels on interactive elements |
| Responsiveness | Usable on screens from 375px (mobile) to 1440px (desktop) |
| No auth (V1) | The app is accessible to anyone on the local network without login |
| Statefulness | No server-side session state in V1; UI state lives in the browser |
| SEO | Not a concern — local app only |
| Dark mode | All UI surfaces support dark mode via Tailwind `dark:` variants |
| Security | Audio file serving validates path is within `/data/audio/archive/` before serving |

---

## 7. Tech Stack

| Component | Choice | Rationale |
|-----------|--------|-----------|
| Framework | Next.js 14 (App Router) | Full-stack React; SSR for fast initial load; API routes co-located |
| Styling | Tailwind CSS | Rapid UI development; dark mode via `class` strategy |
| Component library | shadcn/ui | Accessible, unstyled-by-default; dark mode via CSS variables |
| Data fetching | React Query (TanStack Query) | Automatic caching, polling for queue status, clean loading/error states |
| Database client | `pg` (node-postgres) with raw SQL | Lightweight; avoids ORM overhead for this read-heavy app; full control over FTS queries |
| Audio player | HTML5 `<audio>` element + React context | No dependency; native seek support; context enables persistence across navigation |
| Icons | `lucide-react` | Consistent with shadcn/ui |
| Containerization | Docker + Docker Compose | Part of the shared stack with PRD-01 |

---

## 8. Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Docker Compose                        │
│                                                         │
│  ┌────────────────────────────────────────────────┐    │
│  │          Next.js App (:3000)                   │    │
│  │                                                │    │
│  │  ┌──────────────┐   ┌──────────────────────┐  │    │
│  │  │  React Pages │   │   Next.js API Routes │  │    │
│  │  │  /           │   │   /api/search        │  │    │
│  │  │  /podcasts   │──►│   /api/feeds         │  │    │
│  │  │  /episodes   │   │   /api/episodes      │  │    │
│  │  │  /queue      │   │   /api/queue         │  │    │
│  │  └──────────────┘   │   /api/audio/[id]/.. │  │    │
│  │                     └──────────┬───────────┘  │    │
│  │  ┌──────────────────────────── │ ───────────┐ │    │
│  │  │  AudioPlayerContext         │            │ │    │
│  │  │  (React context, layout)    │            │ │    │
│  │  └─────────────────────────────┘            │ │    │
│  └──────────────────────────────────────────────┘    │
│                                   │                     │
│  ┌────────────────────────────────▼────────────────┐   │
│  │              PostgreSQL (:5432)                  │   │
│  └──────────────────────────────────────────────────┘   │
│                                                         │
│  ┌──────────────────────────────────────────────────┐   │
│  │  FastAPI (Pipeline API :8000) — from PRD-01      │   │
│  │  Called by Next.js API routes for:               │   │
│  │  feed management, queue retries, feed polling    │   │
│  │  health check (warm-up state)                    │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

---

## 9. Key UI Screens

### 9.1 Homepage / Search

```
┌─────────────────────────────────────────────────────────┐
│  PodSearch      Podcasts    Queue [2]    Settings   🌙   │
├─────────────────────────────────────────────────────────┤
│                                                         │
│         ┌─────────────────────────────────────┐        │
│         │ 🔍  Search transcripts...            │        │
│         └─────────────────────────────────────┘        │
│              All Podcasts ▾                             │
│                                                         │
│  ── Results (Page 1 of 4 · 74 results) ──────────────  │
│                                                         │
│  The Tim Ferriss Show · Ep. 712 · John Doe              │
│  SPEAKER_00 · 00:14:32                                  │
│  "...and that's when I realized that **machine          │
│  learning** was the key to solving..."         ▶ 14:32  │
│                                                         │
│  Lex Fridman Podcast · Ep. 401              ⚠ No labels │
│  [Speaker unknown] · 01:02:11                           │
│  "The real problem with **machine learning** today      │
│  is the lack of..."                            ▶ 1:02:11│
│                                                         │
│  ← Previous    Page 1 of 4    Next →                   │
├─────────────────────────────────────────────────────────┤
│  ▶ Lex Fridman #401 · 1:02:11  ──────●────── 1:14:30 🔊│
└─────────────────────────────────────────────────────────┘
```

### 9.2 Episode Transcript View

```
┌─────────────────────────────────────────────────────────┐
│  ← The Tim Ferriss Show                                  │
│  Episode 712: Tools of Titans                           │
│  Published: Jan 15 2025 · 1hr 42min · ✓ Transcribed    │
│                                                         │
│  ┌─────────────────────────────────────────────┐       │
│  │ 🔍  Search within this episode...           │       │
│  └─────────────────────────────────────────────┘       │
│                                                         │
│  [00:00:12]  SPEAKER_00 ✏️                              │
│  Welcome to the Tim Ferriss Show. Today's guest is...   │
│                                                         │
│  --- Episode with diarization failure ---               │
│                                                         │
│  ┌─────────────────────────────────────────────────┐   │
│  │ ⚠ Speaker labels unavailable — diarization     │   │
│  │   failed: pyannote model load error             │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  [00:00:12]  00:00:45                                   │
│  Welcome to the show. Today we're discussing...         │
└─────────────────────────────────────────────────────────┘
```

### 9.3 Queue Dashboard

```
┌─────────────────────────────────────────────────────────┐
│  Queue                                                   │
├─────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────┐   │
│  │ 🔄 Worker is initializing — downloading models  │   │
│  │    (~3 GB). Jobs will begin processing once     │   │
│  │    complete.                                    │   │
│  └─────────────────────────────────────────────────┘   │
│                                                         │
│  ● Active                                               │
│  Lex Fridman #402 — Retrying (2/3) — HTTP 403           │
│  Next attempt in 1m 48s                                 │
│                                                         │
│  ● Active (after retry)                                 │
│  Lex Fridman #402 — Transcribing...                     │
│  ████████████░░░░░░░░  62%                              │
│                                                         │
│  ⏳ Pending  (3)                                        │
│  Huberman Lab #189                                      │
│  Huberman Lab #188                                      │
│  The Tim Ferriss Show #713                              │
│                                                         │
│  ✗ Failed  (2)                                          │
│  Hard Fork #95  [Retry]                                 │
│  Access error (HTTP 403)                                │
│  ▼ Error detail...                                      │
│                                                         │
│  My Podcast #12  [Retry disabled ⓘ]                    │
│  Disk full — free space and retry                       │
│  ▼ Error detail...                                      │
└─────────────────────────────────────────────────────────┘
```

---

## 10. Search Implementation Detail

The core search query (run server-side in a Next.js API route):

```sql
SELECT
  s.id,
  s.start_time,
  s.end_time,
  s.speaker_label,
  COALESCE(sn.display_name, s.speaker_label) AS speaker_display,
  ts_headline('english', s.text, query, 'MaxWords=20, MinWords=10') AS snippet,
  ts_rank(to_tsvector('english', s.text), query) AS rank,
  e.id AS episode_id,
  e.title AS episode_title,
  e.audio_url,
  e.audio_local_path,
  e.has_diarization,
  e.diarization_error,
  f.title AS feed_title,
  f.id AS feed_id
FROM segments s
JOIN episodes e ON s.episode_id = e.id
JOIN feeds f ON e.feed_id = f.id
LEFT JOIN speaker_names sn ON sn.episode_id = e.id AND sn.speaker_label = s.speaker_label,
  plainto_tsquery('english', $1) AS query
WHERE to_tsvector('english', s.text) @@ query
  AND ($2::uuid IS NULL OR f.id = $2)
ORDER BY rank DESC
LIMIT 20 OFFSET $3;
```

The companion count query (run in the same request):

```sql
SELECT COUNT(*)
FROM segments s
JOIN episodes e ON s.episode_id = e.id
JOIN feeds f ON e.feed_id = f.id,
  plainto_tsquery('english', $1) AS query
WHERE to_tsvector('english', s.text) @@ query
  AND ($2::uuid IS NULL OR f.id = $2);
```

`ts_headline` returns the matched text with the search term wrapped in `<b>` tags, which the UI renders highlighted. `has_diarization` and `diarization_error` are returned so the result card can show the "⚠ No labels" badge.

---

## 11. Timestamp Deep Link Logic

```typescript
function buildTimestampUrl(episode: Episode, startTimeSecs: number): string {
  const t = Math.floor(startTimeSecs);
  
  if (episode.audioLocalPath) {
    // Serve via validated API route — path traversal prevention is in the route handler
    const safeName = path.basename(episode.audioLocalPath);
    return `/api/audio/${episode.id}/${encodeURIComponent(safeName)}#t=${t}`;
  }
  
  return `${episode.audioUrl}#t=${t}`;
}
```

**Audio API route path validation (`/api/audio/[episodeId]/[filename]/route.ts`):**

```typescript
import path from 'path';
import fs from 'fs';

const AUDIO_ARCHIVE_DIR = '/data/audio/archive';

export async function GET(req: Request, { params }: { params: { episodeId: string, filename: string } }) {
  // Strip any path separators — treat filename as basename only
  const safeName = path.basename(params.filename);
  const resolved = path.resolve(AUDIO_ARCHIVE_DIR, safeName);
  
  // Verify resolved path stays within archive directory
  if (!resolved.startsWith(AUDIO_ARCHIVE_DIR + path.sep)) {
    return new Response('Invalid path', { status: 400 });
  }
  
  if (!fs.existsSync(resolved)) {
    return new Response('Not found', { status: 404 });
  }
  
  // Stream file with range request support
  // ... range header handling, Content-Type: audio/mpeg
}
```

The inline audio player (for the global persistent player):

```tsx
// AudioPlayerContext loads the file into the persistent player
const { playEpisode } = useAudioPlayer();

<button onClick={() => playEpisode(episode.id, safeName, startTimeSecs)}>
  ▶ Play locally
</button>
```

---

## 12. Feature Roadmap

### MVP (Phase 1)
- Global full-text search across all transcripts (pure rank, no grouping)
- Pagination with accurate total count display
- Timestamp deep links (remote URL with `#t=`)
- Persistent global audio player (layout-level, React context)
- Podcast and episode browsing
- Diarization failure badge/banner in search results, episode list, and episode page
- Speaker label renaming per episode
- Feed management (add/remove, poll now)
- Queue dashboard (status, progress, retry, error classification, retry countdown)
- Worker warm-up banner
- Dark mode (Tailwind `class` strategy, `localStorage` persistence)
- Responsive layout (mobile + desktop)
- Path-safe audio file serving
- Docker Compose integration with PRD-01 services

### V1 (Phase 2)
- Search result grouping by episode (top N segments per episode, avoid one long episode dominating)
- Keyboard navigation of search results
- Export transcript as `.txt` or `.srt` from episode page
- "Copy timestamp link" button

### V2 (Phase 3)
- **Authentication:** NextAuth.js + JWT, invite-only
- **Semantic search:** `pgvector` + `sentence-transformers`
- **Public deployment support:** Caddy reverse proxy, SSL, production Docker Compose profile

---

## 13. Testing Strategy

### Unit Tests (`jest` + `@testing-library/react`)
- Search query builder: correct SQL parameters for various inputs, count query runs alongside main query
- Timestamp URL builder: remote URL, local URL (basename extraction), zero seconds, fractional seconds
- Audio route path validation: valid path passes, path traversal blocked (HTTP 400)
- Speaker display name resolution: with custom name, without, null speaker (no diarization)
- React components: search result card with diarization warning badge; audio player initializes at correct time; empty state renders; dark mode toggle persists to `localStorage`

### Integration Tests
- API route tests using `supertest` against a seeded test database
- `GET /api/search?q=test` → assert result shape, FTS match, pagination, `has_diarization` field returned
- `POST /api/feeds` → assert feed record created
- `GET /api/queue` → assert correct job count, status mapping, retry state
- `GET /api/audio/[id]/[filename]` → valid file served; `../escape` returns 400

### End-to-End Tests (`Playwright`)
- User types search query → results appear → diarization badge visible on affected results
- User clicks timestamp → global audio player loads and seeks to timestamp
- Global player continues playing while navigating between pages
- User toggles dark mode → class applied to `<html>` → preference survives page reload
- User adds RSS feed → feed appears in `/podcasts`
- User renames speaker → search result shows new name

### What is NOT tested
- Visual regression / pixel-perfect layout
- PostgreSQL FTS ranking quality
- Cross-browser audio seek behavior (documented limitation)

---

## 14. Resolved Questions

| # | Question | Decision |
|---|----------|----------|
| OQ-01 | Group results by episode? | No grouping in MVP — pure rank. Grouping in V1. |
| OQ-02 | V2 invite token expiry? | Deferred to V2. |
| OQ-03 | Persistent audio player across navigation? | Yes — global player in root layout via React context. |
| OQ-04 | Dark mode in V1? | Yes — Tailwind `class` strategy, `localStorage` persistence. |

---

## 15. Docker Compose Integration

```yaml
services:
  web:
    build: ./apps/web
    ports:
      - "3000:3000"
    environment:
      DATABASE_URL: postgresql://postgres:password@db:5432/podsearch
      PIPELINE_API_URL: http://pipeline:8000
    depends_on:
      db:
        condition: service_healthy
      pipeline:
        condition: service_healthy   # Changed from service_started — waits for migration
    volumes:
      - audio_data:/data/audio:ro

  pipeline:
    build: ./apps/pipeline
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/api/health"]
      interval: 10s
      timeout: 5s
      retries: 10
      start_period: 30s
    ...
```

**Note on `service_healthy` dependency:** The `web` container now waits for `pipeline` to be healthy (not just started). The pipeline's health endpoint returns HTTP 200 only after Alembic migrations have completed. This closes the race condition where the web app could start before the schema exists.
