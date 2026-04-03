# First-Run Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a 3-screen first-run wizard that auto-opens on first visit, guides users through health check and feed setup, and is re-launchable from a navbar help menu.

**Architecture:** A `SetupWizard` component using Radix Dialog renders 3 step components. Wizard completion state is stored in the existing `system_state` PostgreSQL table via a thin Next.js API route. A `HelpMenu` component in the Navbar provides re-launch access.

**Tech Stack:** React 18, Next.js 14, Radix Dialog + DropdownMenu, TanStack React Query, Tailwind CSS, PostgreSQL (`pg` pool), Jest + React Testing Library.

**Spec:** `docs/superpowers/specs/2026-04-03-first-run-wizard-design.md`

---

## File Structure

```
apps/web/src/
├── app/api/wizard/status/
│   └── route.ts                    # GET/PUT wizard_completed state from system_state table
├── components/
│   ├── SetupWizard.tsx             # Main wizard: Dialog shell, step routing, state management
│   ├── WizardHealthCheck.tsx       # Screen 1: welcome + live health polling
│   ├── WizardAddFeed.tsx           # Screen 2: URL input, mode picker, episode preview
│   ├── WizardComplete.tsx          # Screen 3: links + don't-show checkbox
│   ├── HelpMenu.tsx                # "?" dropdown: Setup Wizard + User Guide links
│   ├── Navbar.tsx                  # Modified: add HelpMenu next to DarkModeToggle
│   └── WizardProvider.tsx          # Context provider: open/close state, auto-show on mount
└── tests/unit/
    ├── wizard-status-route.test.ts # API route tests
    ├── setup-wizard.test.tsx       # Wizard integration tests
    └── help-menu.test.tsx          # HelpMenu tests
```

---

### Task 1: Wizard Status API Route

**Files:**
- Create: `apps/web/src/app/api/wizard/status/route.ts`
- Test: `apps/web/tests/unit/wizard-status-route.test.ts`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/wizard-status-route.test.ts`:

```typescript
/**
 * @jest-environment node
 */
import { GET, PUT } from "@/app/api/wizard/status/route";

// Mock the pg pool
const mockQuery = jest.fn();
jest.mock("@/lib/db", () => ({
  __esModule: true,
  default: { query: (...args: unknown[]) => mockQuery(...args) },
}));

beforeEach(() => {
  mockQuery.mockReset();
});

describe("GET /api/wizard/status", () => {
  it("returns completed: false when key does not exist", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const resp = await GET();
    const data = await resp.json();
    expect(data).toEqual({ completed: false });
    expect(mockQuery).toHaveBeenCalledWith(
      "SELECT value FROM system_state WHERE key = $1",
      ["wizard_completed"]
    );
  });

  it("returns completed: true when key exists with value '1'", async () => {
    mockQuery.mockResolvedValue({ rows: [{ value: "1" }] });
    const resp = await GET();
    const data = await resp.json();
    expect(data).toEqual({ completed: true });
  });
});

describe("PUT /api/wizard/status", () => {
  it("upserts wizard_completed when completed is true", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const req = new Request("http://localhost/api/wizard/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: true }),
    });
    const resp = await PUT(req);
    const data = await resp.json();
    expect(data).toEqual({ completed: true });
    expect(mockQuery).toHaveBeenCalledWith(
      "INSERT INTO system_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      ["wizard_completed", "1"]
    );
  });

  it("deletes wizard_completed when completed is false", async () => {
    mockQuery.mockResolvedValue({ rows: [] });
    const req = new Request("http://localhost/api/wizard/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed: false }),
    });
    const resp = await PUT(req);
    const data = await resp.json();
    expect(data).toEqual({ completed: false });
    expect(mockQuery).toHaveBeenCalledWith(
      "DELETE FROM system_state WHERE key = $1",
      ["wizard_completed"]
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/wizard-status-route.test.ts --no-cache`
Expected: FAIL — module `@/app/api/wizard/status/route` not found

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/app/api/wizard/status/route.ts`:

```typescript
import { NextRequest, NextResponse } from "next/server";
import pool from "@/lib/db";

export const dynamic = "force-dynamic";

const KEY = "wizard_completed";

export async function GET() {
  const { rows } = await pool.query(
    "SELECT value FROM system_state WHERE key = $1",
    [KEY]
  );
  return NextResponse.json({ completed: rows.length > 0 && rows[0].value === "1" });
}

export async function PUT(req: NextRequest) {
  const { completed } = await req.json();

  if (completed) {
    await pool.query(
      "INSERT INTO system_state (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2",
      [KEY, "1"]
    );
  } else {
    await pool.query("DELETE FROM system_state WHERE key = $1", [KEY]);
  }

  return NextResponse.json({ completed: !!completed });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/wizard-status-route.test.ts --no-cache`
Expected: 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/app/api/wizard/status/route.ts apps/web/tests/unit/wizard-status-route.test.ts
git commit -m "feat(wizard): add wizard status API route (#108)"
```

---

### Task 2: WizardProvider (context for open/close + auto-show)

**Files:**
- Create: `apps/web/src/components/WizardProvider.tsx`
- Modify: `apps/web/src/app/layout.tsx`

- [ ] **Step 1: Create WizardProvider**

Create `apps/web/src/components/WizardProvider.tsx`:

```tsx
"use client";

import { createContext, useContext, useState, useEffect, useCallback } from "react";

interface WizardContextType {
  open: boolean;
  setOpen: (open: boolean) => void;
  markCompleted: (completed: boolean) => Promise<void>;
}

const WizardContext = createContext<WizardContextType>({
  open: false,
  setOpen: () => {},
  markCompleted: async () => {},
});

export function useWizard() {
  return useContext(WizardContext);
}

export default function WizardProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [checked, setChecked] = useState(false);

  // Auto-show on first visit
  useEffect(() => {
    if (checked) return;
    fetch("/api/wizard/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.completed) setOpen(true);
      })
      .catch(() => {
        // Fail-open: show wizard if we can't check status
        setOpen(true);
      })
      .finally(() => setChecked(true));
  }, [checked]);

  const markCompleted = useCallback(async (completed: boolean) => {
    await fetch("/api/wizard/status", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ completed }),
    }).catch(() => {});
  }, []);

  return (
    <WizardContext.Provider value={{ open, setOpen, markCompleted }}>
      {children}
    </WizardContext.Provider>
  );
}
```

- [ ] **Step 2: Add WizardProvider to layout.tsx**

In `apps/web/src/app/layout.tsx`, add the import and wrap children:

```tsx
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "@/app/globals.css";
import Navbar from "@/components/Navbar";
import AudioPlayer from "@/components/AudioPlayer";
import Footer from "@/components/Footer";
import { AudioPlayerProvider } from "@/components/AudioPlayerContext";
import QueryProvider from "@/components/QueryProvider";
import WizardProvider from "@/components/WizardProvider";
import SetupWizard from "@/components/SetupWizard";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "Podlog",
  description: "Self-hosted podcast transcription and search",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.className} min-h-screen bg-background flex flex-col`}>
        <QueryProvider>
          <AudioPlayerProvider>
            <WizardProvider>
              <Navbar />
              <main className="max-w-5xl mx-auto px-4 py-8 pb-24 flex-1 w-full">
                {children}
              </main>
              <Footer />
              {/* Global persistent player — fixed to bottom, persists across navigation */}
              <AudioPlayer />
              <SetupWizard />
            </WizardProvider>
          </AudioPlayerProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
```

Note: `SetupWizard` doesn't exist yet — create a placeholder so the build doesn't break:

Create `apps/web/src/components/SetupWizard.tsx` (temporary placeholder):

```tsx
"use client";

export default function SetupWizard() {
  return null;
}
```

- [ ] **Step 3: Commit**

```bash
git add apps/web/src/components/WizardProvider.tsx apps/web/src/components/SetupWizard.tsx apps/web/src/app/layout.tsx
git commit -m "feat(wizard): add WizardProvider context and layout wiring (#108)"
```

---

### Task 3: WizardHealthCheck (Screen 1)

**Files:**
- Create: `apps/web/src/components/WizardHealthCheck.tsx`
- Test: `apps/web/tests/unit/setup-wizard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/setup-wizard.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import WizardHealthCheck from "@/components/WizardHealthCheck";

const mockFetch = jest.fn();
global.fetch = mockFetch;

beforeEach(() => {
  mockFetch.mockReset();
});

describe("WizardHealthCheck", () => {
  const noop = () => {};

  it("shows all services as healthy when API returns OK", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "OK" },
        ],
      }),
    });

    render(<WizardHealthCheck onNext={noop} onSkip={noop} />);

    await waitFor(() => {
      expect(screen.getByText("Database")).toBeInTheDocument();
      expect(screen.getByText("Pipeline API")).toBeInTheDocument();
      expect(screen.getByText("Worker")).toBeInTheDocument();
    });

    // All show healthy badges
    const badges = screen.getAllByText(/Connected|Healthy|Ready/);
    expect(badges).toHaveLength(3);
  });

  it("shows warming up state for worker", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "WARMING_UP",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "WARMING_UP" },
        ],
      }),
    });

    render(<WizardHealthCheck onNext={noop} onSkip={noop} />);

    await waitFor(() => {
      expect(screen.getByText(/Downloading models/i)).toBeInTheDocument();
    });
  });

  it("shows all-ready banner when every service is OK", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "OK" },
        ],
      }),
    });

    render(<WizardHealthCheck onNext={noop} onSkip={noop} />);

    await waitFor(() => {
      expect(screen.getByText(/All systems ready/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: FAIL — module `@/components/WizardHealthCheck` not found

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/WizardHealthCheck.tsx`:

```tsx
"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

interface ServiceStatus {
  name: string;
  status: string;
}

interface HealthResponse {
  status: string;
  services: ServiceStatus[];
}

const STATUS_LABELS: Record<string, Record<string, string>> = {
  Database: { OK: "Connected", DEGRADED: "Degraded" },
  "Pipeline API": { OK: "Healthy", DEGRADED: "Degraded" },
  Worker: { OK: "Ready", WARMING_UP: "Downloading models...", DEGRADED: "Degraded" },
};

function badgeClass(status: string): string {
  if (status === "OK") return "bg-green-900/40 text-green-400";
  if (status === "WARMING_UP") return "bg-yellow-900/40 text-yellow-400";
  return "bg-muted text-muted-foreground";
}

function statusIcon(status: string) {
  if (status === "OK") {
    return <Check className="h-3.5 w-3.5 text-green-400" />;
  }
  if (status === "WARMING_UP") {
    return <span className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse" />;
  }
  return <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />;
}

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

export default function WizardHealthCheck({ onNext, onSkip }: Props) {
  const { data } = useQuery<HealthResponse>({
    queryKey: ["wizard-health"],
    queryFn: async () => {
      const resp = await fetch("/api/pipeline/health");
      return resp.json();
    },
    refetchInterval: 3000,
  });

  const services = data?.services ?? [];
  const allReady = data?.status === "OK";

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Welcome to Podlog</h2>
        <p className="text-sm text-muted-foreground">
          Self-hosted podcast transcription &amp; search.
          <br />
          Everything runs locally — your data never leaves this machine.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-5">
        <p className="text-xs font-semibold text-muted-foreground mb-3">System Status</p>
        <div className="space-y-2">
          {services.map((svc) => (
            <div key={svc.name} className="flex items-center gap-2">
              {statusIcon(svc.status)}
              <span className="text-sm">{svc.name}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${badgeClass(svc.status)}`}>
                {STATUS_LABELS[svc.name]?.[svc.status] ?? svc.status}
              </span>
            </div>
          ))}
        </div>

        {services.some((s) => s.status === "WARMING_UP") && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full animate-pulse" style={{ width: "45%" }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Whisper + pyannote (~3 GB) — first run only
            </p>
          </div>
        )}
      </div>

      {allReady && (
        <div className="rounded-lg border border-green-800 bg-green-950/30 p-3 mb-5 text-center">
          <span className="text-sm text-green-400">All systems ready — let&apos;s add your first podcast!</span>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onSkip}>
          Skip wizard
        </Button>
        <Button onClick={onNext}>Next →</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: 3 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/WizardHealthCheck.tsx apps/web/tests/unit/setup-wizard.test.tsx
git commit -m "feat(wizard): add health check screen (#108)"
```

---

### Task 4: WizardAddFeed (Screen 2)

**Files:**
- Create: `apps/web/src/components/WizardAddFeed.tsx`
- Modify: `apps/web/tests/unit/setup-wizard.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `apps/web/tests/unit/setup-wizard.test.tsx`:

```tsx
import { fireEvent } from "@testing-library/react";
import WizardAddFeed from "@/components/WizardAddFeed";

describe("WizardAddFeed", () => {
  const noop = () => {};

  it("renders URL input and mode selector with test pre-selected", () => {
    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);

    expect(screen.getByPlaceholderText(/feeds\.example\.com/i)).toBeInTheDocument();
    // Test mode button should have the active styling
    const testBtn = screen.getByRole("button", { name: /test/i });
    expect(testBtn).toBeInTheDocument();
  });

  it("shows skip button", () => {
    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);
    expect(screen.getByRole("button", { name: /skip/i })).toBeInTheDocument();
  });

  it("submits feed in test mode", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "feed-1", title: "Test Podcast" }),
    });

    const onNext = jest.fn();
    render(<WizardAddFeed onNext={onNext} onBack={noop} onSkip={noop} />);

    const input = screen.getByPlaceholderText(/feeds\.example\.com/i);
    fireEvent.change(input, { target: { value: "https://example.com/feed.xml" } });

    const addBtn = screen.getByRole("button", { name: /add feed/i });
    fireEvent.click(addBtn);

    await waitFor(() => {
      expect(mockFetch).toHaveBeenCalledWith("/api/feeds", expect.objectContaining({
        method: "POST",
      }));
      expect(onNext).toHaveBeenCalled();
    });
  });

  it("shows error on failed submission", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: async () => ({ detail: "Invalid RSS feed URL" }),
    });

    render(<WizardAddFeed onNext={noop} onBack={noop} onSkip={noop} />);

    const input = screen.getByPlaceholderText(/feeds\.example\.com/i);
    fireEvent.change(input, { target: { value: "https://bad-url" } });

    fireEvent.click(screen.getByRole("button", { name: /add feed/i }));

    await waitFor(() => {
      expect(screen.getByText(/Invalid RSS feed URL/i)).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: FAIL — module `@/components/WizardAddFeed` not found

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/WizardAddFeed.tsx`:

```tsx
"use client";

import { useState } from "react";
import { FlaskConical, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface EpisodePreview {
  guid: string;
  title: string | null;
  published_at: string | null;
  duration_secs: number | null;
}

interface FeedPreview {
  title: string | null;
  episodes: EpisodePreview[];
}

function formatDuration(secs: number | null): string {
  if (!secs) return "";
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

interface Props {
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}

export default function WizardAddFeed({ onNext, onBack, onSkip }: Props) {
  const [url, setUrl] = useState("");
  const [mode, setMode] = useState<"test" | "selective" | "full">("test");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Selective mode state
  const [previewStep, setPreviewStep] = useState(false);
  const [preview, setPreview] = useState<FeedPreview | null>(null);
  const [selectedGuids, setSelectedGuids] = useState<Set<string>>(new Set());
  const [previewLoading, setPreviewLoading] = useState(false);

  function toggleGuid(guid: string) {
    setSelectedGuids((prev) => {
      const next = new Set(prev);
      if (next.has(guid)) next.delete(guid);
      else next.add(guid);
      return next;
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    // Selective mode: fetch preview first
    if (mode === "selective" && !previewStep) {
      setPreviewLoading(true);
      try {
        const resp = await fetch(`/api/feeds/preview?url=${encodeURIComponent(url.trim())}`);
        if (!resp.ok) {
          const err = await resp.json().catch(() => ({}));
          throw new Error(err.detail ?? "Couldn't fetch episodes — check the URL and try again");
        }
        const data: FeedPreview = await resp.json();
        setPreview(data);
        setPreviewStep(true);
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Failed to load feed preview");
      } finally {
        setPreviewLoading(false);
      }
      return;
    }

    // Submit feed
    setSubmitting(true);
    try {
      const resp = await fetch("/api/feeds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: url.trim(),
          mode,
          selected_guids: mode === "selective" ? Array.from(selectedGuids) : undefined,
        }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.detail ?? "Failed to add feed");
      }
      onNext();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Failed to add feed");
    } finally {
      setSubmitting(false);
    }
  }

  // Episode picker for selective mode
  if (previewStep && preview) {
    return (
      <div>
        <div className="text-center mb-4">
          <h2 className="text-2xl font-bold mb-2">Add Your First Podcast</h2>
          <p className="text-sm text-muted-foreground">Pick which episodes to process.</p>
        </div>

        <div className="rounded-lg border bg-card p-3 mb-3">
          <p className="text-sm font-semibold">{preview.title ?? url}</p>
          <p className="text-xs text-muted-foreground">{preview.episodes.length} episodes</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="max-h-56 overflow-y-auto divide-y rounded-md border">
            {preview.episodes.map((ep) => (
              <label
                key={ep.guid}
                className="flex items-start gap-3 px-3 py-2 cursor-pointer hover:bg-accent/40 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={selectedGuids.has(ep.guid)}
                  onChange={() => toggleGuid(ep.guid)}
                  className="mt-0.5 shrink-0"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">{ep.title ?? ep.guid}</p>
                  <p className="text-xs text-muted-foreground">
                    {ep.published_at ? new Date(ep.published_at).toLocaleDateString() : null}
                    {ep.published_at && ep.duration_secs ? " · " : null}
                    {formatDuration(ep.duration_secs)}
                  </p>
                </div>
              </label>
            ))}
          </div>

          <p className="text-xs text-muted-foreground">{selectedGuids.size} episodes selected</p>

          {error && <p className="text-sm text-destructive">{error}</p>}

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setPreviewStep(false);
                setPreview(null);
                setSelectedGuids(new Set());
                setError(null);
              }}
            >
              ← Back
            </Button>
            <Button type="submit" disabled={selectedGuids.size === 0 || submitting}>
              {submitting ? "Adding..." : `Add ${selectedGuids.size} Episodes`}
            </Button>
          </div>
        </form>
      </div>
    );
  }

  // Main feed input + mode selector
  return (
    <div>
      <div className="text-center mb-5">
        <h2 className="text-2xl font-bold mb-2">Add Your First Podcast</h2>
        <p className="text-sm text-muted-foreground">
          Paste an RSS feed URL to get started. We recommend <strong>Test mode</strong> for your first feed — it grabs one episode so you can see results fast.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-1">Feed URL</label>
          <Input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://feeds.example.com/podcast.xml"
            required
            autoFocus
          />
        </div>

        <div>
          <label className="text-xs font-semibold text-muted-foreground block mb-2">Mode</label>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setMode("test")}
              className={`flex-1 flex items-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                mode === "test"
                  ? "bg-violet-100 text-violet-800 dark:bg-violet-900 dark:text-violet-200 ring-1 ring-violet-300 dark:ring-violet-700"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <FlaskConical size={14} />
              <div className="text-left">
                <div>Test</div>
                <div className="text-xs opacity-70 font-normal">1 episode — quick trial</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("selective")}
              className={`flex-1 flex items-center gap-1.5 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                mode === "selective"
                  ? "bg-sky-100 text-sky-800 dark:bg-sky-900 dark:text-sky-200 ring-1 ring-sky-300 dark:ring-sky-700"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <ListChecks size={14} />
              <div className="text-left">
                <div>Selective</div>
                <div className="text-xs opacity-70 font-normal">Pick specific episodes</div>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setMode("full")}
              className={`flex-1 px-3 py-2.5 rounded-md text-sm font-medium transition-colors ${
                mode === "full"
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent"
              }`}
            >
              <div className="text-left">
                <div>Full</div>
                <div className="text-xs opacity-70 font-normal">All episodes + auto-poll</div>
              </div>
            </button>
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="flex gap-2 justify-end">
          <Button type="button" variant="outline" onClick={onBack}>
            ← Back
          </Button>
          <Button type="button" variant="ghost" onClick={onSkip}>
            Skip — I&apos;ll explore first
          </Button>
          <Button type="submit" disabled={submitting || previewLoading}>
            {previewLoading
              ? "Loading..."
              : mode === "selective"
              ? "Next"
              : submitting
              ? "Adding..."
              : "Add Feed"}
          </Button>
        </div>
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: 7 tests PASS (3 health + 4 feed)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/WizardAddFeed.tsx apps/web/tests/unit/setup-wizard.test.tsx
git commit -m "feat(wizard): add feed screen (#108)"
```

---

### Task 5: WizardComplete (Screen 3)

**Files:**
- Create: `apps/web/src/components/WizardComplete.tsx`
- Modify: `apps/web/tests/unit/setup-wizard.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `apps/web/tests/unit/setup-wizard.test.tsx`:

```tsx
import WizardComplete from "@/components/WizardComplete";

describe("WizardComplete", () => {
  it("shows 'You're All Set!' when feed was added", () => {
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText(/You're All Set/i)).toBeInTheDocument();
  });

  it("shows 'Ready When You Are' when feed was skipped", () => {
    render(<WizardComplete feedAdded={false} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText(/Ready When You Are/i)).toBeInTheDocument();
  });

  it("highlights 'Add Your First Feed' link when feed was skipped", () => {
    render(<WizardComplete feedAdded={false} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByText(/Add Your First Feed/i)).toBeInTheDocument();
  });

  it("shows 'Don't show this wizard' checkbox", () => {
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={() => {}} />);
    expect(screen.getByLabelText(/Don't show this wizard/i)).toBeInTheDocument();
  });

  it("calls onDontShowChange when checkbox is toggled", () => {
    const onChange = jest.fn();
    render(<WizardComplete feedAdded={true} onFinish={() => {}} onDontShowChange={onChange} />);
    fireEvent.click(screen.getByLabelText(/Don't show this wizard/i));
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: FAIL — module `@/components/WizardComplete` not found

- [ ] **Step 3: Write the implementation**

Create `apps/web/src/components/WizardComplete.tsx`:

```tsx
"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

interface LinkItem {
  href: string;
  title: string;
  description: string;
  highlight?: boolean;
}

interface Props {
  feedAdded: boolean;
  onFinish: () => void;
  onDontShowChange: (checked: boolean) => void;
}

export default function WizardComplete({ feedAdded, onFinish, onDontShowChange }: Props) {
  const [dontShow, setDontShow] = useState(false);

  const links: LinkItem[] = feedAdded
    ? [
        { href: "/", title: "Search", description: "Search across all your transcripts once processing completes" },
        { href: "/queue", title: "Queue", description: "Watch your episode move through the pipeline stages" },
        { href: "/feeds", title: "Add More Feeds", description: "Subscribe to more podcasts from the Feeds page" },
        { href: "https://github.com/brlauuu/podlog/tree/main/docs/guide", title: "User Guide", description: "Full documentation covering all features" },
      ]
    : [
        { href: "/feeds", title: "Add Your First Feed", description: "Head to the Feeds page to subscribe to a podcast", highlight: true },
        { href: "/", title: "Search", description: "Search across transcripts once you have processed episodes" },
        { href: "/queue", title: "Queue", description: "Monitor processing progress" },
        { href: "https://github.com/brlauuu/podlog/tree/main/docs/guide", title: "User Guide", description: "Full documentation covering all features" },
      ];

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">
          {feedAdded ? "You're All Set!" : "Ready When You Are"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {feedAdded
            ? "Your first episode is queued for processing. Depending on episode length and your hardware, it may take 30-90 minutes."
            : "No feeds added yet — here's where to go when you're ready."}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-5">
        <p className="text-xs font-semibold text-muted-foreground mb-3">
          {feedAdded ? "What's Next" : "Getting Started"}
        </p>
        <div className="space-y-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onFinish}
              className={`flex items-center gap-3 p-2.5 rounded-md transition-colors ${
                link.highlight
                  ? "border-2 border-primary bg-primary/5"
                  : "border border-border hover:bg-accent/40"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${link.highlight ? "text-primary" : ""}`}>
                  {link.title}
                </p>
                <p className="text-xs text-muted-foreground">{link.description}</p>
              </div>
              <ChevronRight className={`h-4 w-4 shrink-0 ${link.highlight ? "text-primary" : "text-muted-foreground"}`} />
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => {
              setDontShow(e.target.checked);
              onDontShowChange(e.target.checked);
            }}
            className="accent-primary"
          />
          Don&apos;t show this wizard on next visit
        </label>
        <Button onClick={onFinish}>Get Started</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: 12 tests PASS (3 health + 4 feed + 5 complete)

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/WizardComplete.tsx apps/web/tests/unit/setup-wizard.test.tsx
git commit -m "feat(wizard): add completion screen (#108)"
```

---

### Task 6: SetupWizard (main dialog shell)

**Files:**
- Modify: `apps/web/src/components/SetupWizard.tsx` (replace placeholder)
- Modify: `apps/web/tests/unit/setup-wizard.test.tsx`

- [ ] **Step 1: Add failing tests**

Append to `apps/web/tests/unit/setup-wizard.test.tsx`:

```tsx
import SetupWizard from "@/components/SetupWizard";
import { useWizard } from "@/components/WizardProvider";

// Mock WizardProvider context
jest.mock("@/components/WizardProvider", () => ({
  useWizard: jest.fn(),
}));

const mockUseWizard = useWizard as jest.Mock;

describe("SetupWizard", () => {
  beforeEach(() => {
    // Default: health returns OK
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        status: "OK",
        services: [
          { name: "Database", status: "OK" },
          { name: "Pipeline API", status: "OK" },
          { name: "Worker", status: "OK" },
        ],
      }),
    });
  });

  it("renders nothing when closed", () => {
    mockUseWizard.mockReturnValue({ open: false, setOpen: jest.fn(), markCompleted: jest.fn() });
    const { container } = render(<SetupWizard />);
    expect(container.innerHTML).toBe("");
  });

  it("renders Screen 1 when open", async () => {
    mockUseWizard.mockReturnValue({ open: true, setOpen: jest.fn(), markCompleted: jest.fn() });
    render(<SetupWizard />);
    await waitFor(() => {
      expect(screen.getByText("Welcome to Podlog")).toBeInTheDocument();
    });
  });

  it("shows step dots", async () => {
    mockUseWizard.mockReturnValue({ open: true, setOpen: jest.fn(), markCompleted: jest.fn() });
    render(<SetupWizard />);
    await waitFor(() => {
      expect(screen.getByTestId("step-dots")).toBeInTheDocument();
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: FAIL — SetupWizard renders null (placeholder), no "Welcome to Podlog" found

- [ ] **Step 3: Replace SetupWizard placeholder with full implementation**

Replace `apps/web/src/components/SetupWizard.tsx`:

```tsx
"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useWizard } from "@/components/WizardProvider";
import WizardHealthCheck from "@/components/WizardHealthCheck";
import WizardAddFeed from "@/components/WizardAddFeed";
import WizardComplete from "@/components/WizardComplete";

type Step = 1 | 2 | 3;

export default function SetupWizard() {
  const { open, setOpen, markCompleted } = useWizard();
  const [step, setStep] = useState<Step>(1);
  const [feedAdded, setFeedAdded] = useState(false);
  const [dontShow, setDontShow] = useState(false);
  const router = useRouter();

  function handleSkip() {
    markCompleted(true);
    close();
  }

  function close() {
    setOpen(false);
    setStep(1);
    setFeedAdded(false);
    setDontShow(false);
  }

  function handleFinish() {
    if (dontShow) markCompleted(true);
    close();
    if (feedAdded) router.push("/queue");
  }

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) handleSkip(); }}>
      <DialogContent className="max-w-xl" onPointerDownOutside={(e) => e.preventDefault()}>
        {step === 1 && (
          <WizardHealthCheck
            onNext={() => setStep(2)}
            onSkip={handleSkip}
          />
        )}
        {step === 2 && (
          <WizardAddFeed
            onNext={() => { setFeedAdded(true); setStep(3); }}
            onBack={() => setStep(1)}
            onSkip={() => { setFeedAdded(false); setStep(3); }}
          />
        )}
        {step === 3 && (
          <WizardComplete
            feedAdded={feedAdded}
            onFinish={handleFinish}
            onDontShowChange={setDontShow}
          />
        )}

        {/* Step dots */}
        <div className="flex justify-center gap-1.5 pt-2" data-testid="step-dots">
          {([1, 2, 3] as Step[]).map((s) => (
            <span
              key={s}
              className={`h-2 w-2 rounded-full ${s === step ? "bg-primary" : "bg-muted"}`}
            />
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx --no-cache`
Expected: 15 tests PASS

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/components/SetupWizard.tsx apps/web/tests/unit/setup-wizard.test.tsx
git commit -m "feat(wizard): add main dialog shell with step navigation (#108)"
```

---

### Task 7: HelpMenu + Navbar integration

**Files:**
- Create: `apps/web/src/components/HelpMenu.tsx`
- Modify: `apps/web/src/components/Navbar.tsx`
- Test: `apps/web/tests/unit/help-menu.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `apps/web/tests/unit/help-menu.test.tsx`:

```tsx
/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import HelpMenu from "@/components/HelpMenu";

// Mock WizardProvider
const mockSetOpen = jest.fn();
jest.mock("@/components/WizardProvider", () => ({
  useWizard: () => ({ open: false, setOpen: mockSetOpen, markCompleted: jest.fn() }),
}));

// Mock next/navigation
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: jest.fn() }),
}));

beforeEach(() => {
  mockSetOpen.mockReset();
});

describe("HelpMenu", () => {
  it("renders the help button", () => {
    render(<HelpMenu />);
    expect(screen.getByRole("button", { name: /help/i })).toBeInTheDocument();
  });

  it("shows dropdown items on click", async () => {
    render(<HelpMenu />);
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    expect(await screen.findByText("Setup Wizard")).toBeInTheDocument();
    expect(await screen.findByText("User Guide")).toBeInTheDocument();
  });

  it("opens wizard when Setup Wizard is clicked", async () => {
    render(<HelpMenu />);
    fireEvent.click(screen.getByRole("button", { name: /help/i }));
    fireEvent.click(await screen.findByText("Setup Wizard"));
    expect(mockSetOpen).toHaveBeenCalledWith(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd apps/web && npx jest tests/unit/help-menu.test.tsx --no-cache`
Expected: FAIL — module `@/components/HelpMenu` not found

- [ ] **Step 3: Create HelpMenu component**

Create `apps/web/src/components/HelpMenu.tsx`:

```tsx
"use client";

import { HelpCircle, Wand2, BookOpen } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWizard } from "@/components/WizardProvider";

export default function HelpMenu() {
  const { setOpen } = useWizard();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Help"
          className="flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuItem onClick={() => setOpen(true)} className="cursor-pointer gap-2">
          <Wand2 className="h-4 w-4" />
          Setup Wizard
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <a
            href="https://github.com/brlauuu/podlog/tree/main/docs/guide"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BookOpen className="h-4 w-4" />
            User Guide
          </a>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
```

- [ ] **Step 4: Update Navbar to include HelpMenu**

Modify `apps/web/src/components/Navbar.tsx`:

```tsx
"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import DarkModeToggle from "@/components/DarkModeToggle";
import HelpMenu from "@/components/HelpMenu";

const NAV_LINKS = [
  { href: "/", label: "Search" },
  { href: "/podcasts", label: "Podcasts" },
  { href: "/queue", label: "Queue" },
  { href: "/notifications", label: "Notifications" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-semibold text-lg tracking-tight">
          Podlog
        </Link>

        <div className="flex items-center gap-1 flex-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname === link.href
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <HelpMenu />
          <DarkModeToggle />
        </div>
      </div>
    </nav>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd apps/web && npx jest tests/unit/help-menu.test.tsx --no-cache`
Expected: 3 tests PASS

- [ ] **Step 6: Run all wizard tests**

Run: `cd apps/web && npx jest tests/unit/setup-wizard.test.tsx tests/unit/help-menu.test.tsx tests/unit/wizard-status-route.test.ts --no-cache`
Expected: All tests PASS

- [ ] **Step 7: Commit**

```bash
git add apps/web/src/components/HelpMenu.tsx apps/web/src/components/Navbar.tsx apps/web/tests/unit/help-menu.test.tsx
git commit -m "feat(wizard): add help menu and navbar integration (#108)"
```

---

### Task 8: Final integration test and PR

- [ ] **Step 1: Run the full test suite**

Run: `cd apps/web && npx jest --no-cache`
Expected: All tests PASS (existing + new)

- [ ] **Step 2: Verify the file structure**

```bash
ls -la apps/web/src/components/SetupWizard.tsx \
       apps/web/src/components/WizardHealthCheck.tsx \
       apps/web/src/components/WizardAddFeed.tsx \
       apps/web/src/components/WizardComplete.tsx \
       apps/web/src/components/HelpMenu.tsx \
       apps/web/src/components/WizardProvider.tsx \
       apps/web/src/app/api/wizard/status/route.ts
```

Expected: 7 files exist.

- [ ] **Step 3: Push and create PR**

```bash
git push -u origin 108-first-run-wizard
gh pr create --title "feat: add first-run setup wizard" --body "$(cat <<'EOF'
## Summary
- 3-screen setup wizard: health check, add feed, completion links
- Auto-opens on first visit (tracked via `system_state.wizard_completed`)
- Re-launchable from "?" help icon in navbar
- Full feed-adding flow inline (test/selective/full modes)
- Health polling every 3s with live status badges

## Components
- `SetupWizard` — Dialog shell with step routing
- `WizardHealthCheck` — Screen 1: welcome + live health polling
- `WizardAddFeed` — Screen 2: URL input, mode picker, episode preview
- `WizardComplete` — Screen 3: navigation links + don't-show checkbox
- `HelpMenu` — Navbar dropdown with wizard re-launch + user guide link
- `WizardProvider` — Context for wizard open/close state
- `GET/PUT /api/wizard/status` — Wizard completion state API

## Testing
- API route tests (GET/PUT wizard status)
- Component tests for all 3 screens
- HelpMenu dropdown tests
- SetupWizard integration tests

Closes #108

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```
