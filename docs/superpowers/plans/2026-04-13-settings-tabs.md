# Settings Page Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert the settings page from a single-scroll layout into two tabs ("Notifications" and "Remote Inference"), each with its own Save button.

**Architecture:** Install shadcn/ui Tabs component, then refactor `NotificationSettings.tsx` to split `dirty` state into `dirtyNotifications` + `dirtyInference`, route `handleChange` to the correct tracker by field key, and wrap each section in a `<TabsContent>` with its own Save button. No changes to `NotificationSection`, `RemoteInferenceSection`, or API routes.

**Tech Stack:** shadcn/ui Tabs (Radix UI), React `useState`, existing `/api/notifications/settings` PUT endpoint

---

### Task 1: Install shadcn Tabs component

**Files:**
- Create: `apps/web/src/components/ui/tabs.tsx`

- [ ] **Step 1: Install the component**

```bash
cd /home/brlauuu/repos/podlog/apps/web && npx shadcn@latest add tabs
```

Expected output: `✔ Done` and new file `src/components/ui/tabs.tsx` created.

- [ ] **Step 2: Verify file exists**

```bash
ls /home/brlauuu/repos/podlog/apps/web/src/components/ui/tabs.tsx
```

Expected: file path printed (no error).

- [ ] **Step 3: Commit**

```bash
cd /home/brlauuu/repos/podlog
git add apps/web/src/components/ui/tabs.tsx apps/web/package.json apps/web/package-lock.json
git commit -m "chore(web): install shadcn Tabs component"
```

---

### Task 2: Refactor `NotificationSettings.tsx` to tabbed layout

**Files:**
- Modify: `apps/web/src/components/NotificationSettings.tsx`

- [ ] **Step 1: Replace the component with the tabbed version**

Replace the entire contents of `apps/web/src/components/NotificationSettings.tsx` with:

```tsx
"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Toast } from "./NotificationSettingsSections";
import NotificationSection from "./NotificationSection";
import RemoteInferenceSection from "./RemoteInferenceSection";

const INFERENCE_FIELDS = new Set<keyof Settings>([
  "inference_provider",
  "fireworks_api_key",
  "fireworks_audio_base_url",
  "fireworks_stt_model",
  "fireworks_stt_diarize",
  "fireworks_chat_base_url",
  "fireworks_chat_model",
  "fireworks_stt_cost_per_minute_usd",
  "embedding_provider",
  "embedding_model",
  "fireworks_embedding_base_url",
  "fireworks_embedding_model",
]);

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [savingInference, setSavingInference] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [dirtyNotifications, setDirtyNotifications] = useState<Partial<Settings>>({});
  const [dirtyInference, setDirtyInference] = useState<Partial<Settings>>({});

  useEffect(() => {
    fetch("/api/notifications/settings")
      .then((r) => r.json())
      .then((data) => setSettings(data))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  if (!settings) {
    return (
      <div className="text-muted-foreground text-sm">Loading settings...</div>
    );
  }

  function handleChange(
    field: keyof Settings,
    value: string | number | boolean | null
  ) {
    setSettings((prev) => (prev ? { ...prev, [field]: value } : prev));
    if (INFERENCE_FIELDS.has(field)) {
      setDirtyInference((prev) => ({ ...prev, [field]: value }));
    } else {
      setDirtyNotifications((prev) => ({ ...prev, [field]: value }));
    }
  }

  async function handleSaveNotifications() {
    if (Object.keys(dirtyNotifications).length === 0) return;
    setSavingNotifications(true);
    try {
      const resp = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirtyNotifications),
      });
      if (resp.ok) {
        const updated = await resp.json();
        setSettings(updated);
        setDirtyNotifications({});
        setToast({ message: "Settings saved", type: "success" });
      } else {
        const err = await resp.json();
        setToast({ message: err.error || "Failed to save", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setSavingNotifications(false);
    }
  }

  async function handleSaveInference() {
    if (Object.keys(dirtyInference).length === 0) return;
    setSavingInference(true);
    try {
      const resp = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirtyInference),
      });
      if (resp.ok) {
        const updated = await resp.json();
        setSettings(updated);
        setDirtyInference({});
        if (updated.fireworks_key_warning) {
          setToast({ message: updated.fireworks_key_warning, type: "error" });
          return;
        }
        setToast({ message: "Settings saved", type: "success" });
      } else {
        const err = await resp.json();
        setToast({ message: err.error || "Failed to save", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setSavingInference(false);
    }
  }

  async function handleTest(channel: "telegram" | "email") {
    setTesting(true);
    try {
      const resp = await fetch("/api/notifications/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel }),
      });
      if (resp.ok) {
        setToast({ message: "Test message sent", type: "success" });
      } else {
        const err = await resp.json();
        setToast({ message: err.error || "Test failed", type: "error" });
      }
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setTesting(false);
    }
  }

  const actionButtonClass =
    "px-5 py-2 rounded-md bg-action text-action-foreground text-sm font-medium hover:bg-action/90 disabled:opacity-50";

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure notifications and remote inference providers.
        </p>
      </div>

      <Tabs defaultValue="notifications">
        <TabsList className="mb-6">
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="inference">Remote Inference</TabsTrigger>
        </TabsList>

        <TabsContent value="notifications">
          <NotificationSection
            settings={settings}
            onChange={handleChange}
            onTest={handleTest}
            testing={testing}
          />
          <div className="flex gap-3 mt-8 mb-4">
            <button
              className={actionButtonClass}
              onClick={handleSaveNotifications}
              disabled={savingNotifications || Object.keys(dirtyNotifications).length === 0}
            >
              {savingNotifications ? "Saving..." : "Save"}
            </button>
          </div>
        </TabsContent>

        <TabsContent value="inference">
          <RemoteInferenceSection settings={settings} onChange={handleChange} />
          <div className="flex gap-3 mt-8 mb-4">
            <button
              className={actionButtonClass}
              onClick={handleSaveInference}
              disabled={savingInference || Object.keys(dirtyInference).length === 0}
            >
              {savingInference ? "Saving..." : "Save"}
            </button>
          </div>
        </TabsContent>
      </Tabs>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
```

- [ ] **Step 2: Verify typecheck passes**

```bash
cd /home/brlauuu/repos/podlog/apps/web && npx tsc --noEmit 2>&1 | head -20
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
cd /home/brlauuu/repos/podlog
git add apps/web/src/components/NotificationSettings.tsx
git commit -m "feat(settings): convert to tabbed layout with per-tab save buttons (fixes #378)"
```

---

### Task 3: Update tests for tabbed layout

**Files:**
- Modify: `apps/web/tests/unit/notification-settings.test.tsx`

The following tests need updates because:
- `shows pipeline step cards` and `shows fireworks API key field` check content in the Remote Inference tab, which is not active by default — they need to click the "Remote Inference" tab first.
- `save button is disabled when no changes` uses `getByRole("button", { name: /save/i })` which now matches two buttons — needs `getAllByRole` or a more specific query.
- `calls PUT on save` fires the Save button after changing a Notifications field — still works but needs the specific Notifications tab Save button.

- [ ] **Step 1: Update the test file**

Replace the entire contents of `apps/web/tests/unit/notification-settings.test.tsx` with:

```tsx
/**
 * @jest-environment jsdom
 */
import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import NotificationSettings from "@/components/NotificationSettings";

// Mock fetch globally
const mockFetch = jest.fn();
global.fetch = mockFetch;

const defaultSettings = {
  telegram_bot_token: null,
  telegram_chat_id: null,
  notification_email_to: null,
  notification_email_from: "podlog@localhost",
  smtp_host: "host.docker.internal",
  smtp_port: 25,
  smtp_user: null,
  smtp_password: null,
  smtp_use_tls: false,
  notification_frequency: "immediate",
  health_check_notifications_enabled: true,
  inference_provider: "local",
  fireworks_api_key: null,
  fireworks_audio_base_url: "https://audio-turbo.api.fireworks.ai",
  fireworks_stt_model: "whisper-v3-turbo",
  fireworks_stt_diarize: true,
  fireworks_stt_cost_per_minute_usd: 0.006,
  fireworks_chat_base_url: "https://api.fireworks.ai/inference/v1",
  fireworks_chat_model: "accounts/fireworks/models/llama-v3p1-8b-instruct",
  embedding_provider: "local",
  embedding_model: "all-MiniLM-L6-v2",
  fireworks_embedding_base_url: "https://api.fireworks.ai/inference/v1",
  fireworks_embedding_model: "BAAI/bge-small-en-v1.5",
  telegram_configured: false,
  email_configured: false,
  fireworks_configured: false,
};

beforeEach(() => {
  mockFetch.mockReset();
  mockFetch.mockImplementation((url: string) => {
    if (url === "/api/hardware") {
      return Promise.resolve({
        ok: true,
        json: async () => ({
          hardware: null,
          profile: null,
          profile_label: null,
          estimates: {
            transcription_minutes_per_hour: null,
            embedding_seconds_per_hour: null,
            remote_transcription_minutes_per_hour: 3,
            remote_embedding_seconds_per_hour: 5,
            remote_cost_per_hour_usd: 0.36,
          },
        }),
      });
    }
    return Promise.resolve({
      ok: true,
      json: async () => ({ ...defaultSettings }),
    });
  });
});

describe("NotificationSettings", () => {
  it("renders both tab triggers", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByRole("tab", { name: "Notifications" })).toBeInTheDocument();
      expect(screen.getByRole("tab", { name: "Remote Inference" })).toBeInTheDocument();
    });
  });

  it("shows telegram fields in Notifications tab (default)", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/bot token/i)).toBeInTheDocument();
      expect(screen.getByLabelText(/chat id/i)).toBeInTheDocument();
    });
  });

  it("shows email fields in Notifications tab (default)", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByText(/send to/i)).toBeInTheDocument();
      expect(screen.getByText(/from address/i)).toBeInTheDocument();
    });
  });

  it("shows general settings in Notifications tab (default)", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByLabelText(/notification frequency/i)).toBeInTheDocument();
    });
  });

  it("shows pipeline step cards in Remote Inference tab", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: "Remote Inference" }));
    fireEvent.click(screen.getByRole("tab", { name: "Remote Inference" }));
    await waitFor(() => {
      expect(screen.getByText("Transcription")).toBeInTheDocument();
      expect(screen.getByText("Diarization")).toBeInTheDocument();
      expect(screen.getByText("Speaker Inference")).toBeInTheDocument();
      expect(screen.getByText("Embedding")).toBeInTheDocument();
      expect(screen.getByText("RAG / Ask")).toBeInTheDocument();
    });
  });

  it("calls PUT on save in Notifications tab", async () => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/hardware") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ hardware: null, profile: null, profile_label: null, estimates: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({ ...defaultSettings }),
      });
    });

    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/bot token/i));

    fireEvent.change(screen.getByLabelText(/bot token/i), {
      target: { value: "123:ABC" },
    });

    // Click the Save button in the active (Notifications) tab
    const saveButtons = screen.getAllByRole("button", { name: /save/i });
    fireEvent.click(saveButtons[0]);

    await waitFor(() => {
      const putCall = mockFetch.mock.calls.find(
        (c: [string, RequestInit?]) => c[1]?.method === "PUT"
      );
      expect(putCall).toBeTruthy();
    });
  });

  it("disables test button when telegram not configured", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      const testBtn = screen.getByRole("button", { name: /send test message/i });
      expect(testBtn).toBeDisabled();
    });
  });

  it("shows fireworks API key field in Remote Inference tab", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: "Remote Inference" }));
    fireEvent.click(screen.getByRole("tab", { name: "Remote Inference" }));
    await waitFor(() => {
      expect(screen.getByText(/fireworks api key/i)).toBeInTheDocument();
    });
  });

  it("Notifications Save button is disabled when no changes", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByLabelText(/bot token/i));
    const saveButtons = screen.getAllByRole("button", { name: /save/i });
    expect(saveButtons[0]).toBeDisabled();
  });

  it("Remote Inference Save button is disabled when no changes", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByRole("tab", { name: "Remote Inference" }));
    fireEvent.click(screen.getByRole("tab", { name: "Remote Inference" }));
    await waitFor(() => {
      const saveButtons = screen.getAllByRole("button", { name: /save/i });
      expect(saveButtons[0]).toBeDisabled();
    });
  });
});

describe("Email tag input", () => {
  beforeEach(() => {
    mockFetch.mockImplementation((url: string) => {
      if (url === "/api/hardware") {
        return Promise.resolve({
          ok: true,
          json: async () => ({ hardware: null, profile: null, profile_label: null, estimates: {} }),
        });
      }
      return Promise.resolve({
        ok: true,
        json: async () => ({
          ...defaultSettings,
          notification_email_to: "existing@example.com",
          email_configured: true,
        }),
      });
    });
  });

  it("displays existing emails as tags", async () => {
    render(<NotificationSettings />);
    await waitFor(() => {
      expect(screen.getByText("existing@example.com")).toBeInTheDocument();
    });
  });

  it("adds a valid email on Enter", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "new@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("new@example.com")).toBeInTheDocument();
  });

  it("rejects an invalid email with error message", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "not-an-email" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/invalid email/i)).toBeInTheDocument();
  });

  it("removes an email when X is clicked", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const removeBtn = screen.getByRole("button", { name: /remove existing@example.com/i });
    fireEvent.click(removeBtn);

    expect(screen.queryByText("existing@example.com")).not.toBeInTheDocument();
  });

  it("prevents duplicate emails", async () => {
    render(<NotificationSettings />);
    await waitFor(() => screen.getByText("existing@example.com"));

    const input = screen.getByPlaceholderText(/add email/i);
    fireEvent.change(input, { target: { value: "existing@example.com" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText(/already added/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the full test suite**

```bash
cd /home/brlauuu/repos/podlog/apps/web && npx jest --no-coverage 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
cd /home/brlauuu/repos/podlog
git add apps/web/tests/unit/notification-settings.test.tsx
git commit -m "test(settings): update tests for tabbed layout"
```

---

### Task 4: Final verification

**Files:** none

- [ ] **Step 1: Run full test suite and typecheck**

```bash
cd /home/brlauuu/repos/podlog/apps/web && npx tsc --noEmit && npx jest --no-coverage 2>&1 | tail -10
```

Expected: typecheck clean, all tests pass.
