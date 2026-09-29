"use client";

import { useCallback, useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Toast } from "./NotificationSettingsSections";
import { SettingsSchema } from "@/lib/settings-schema";
import NotificationSection from "./NotificationSection";
import RemoteInferenceSection from "./RemoteInferenceSection";
import BackupsSection from "./BackupsSection";
import PromptsSection from "./PromptsSection";
import {
  UnsavedChangesBar,
  UnsavedChangesContext,
  useLeaveWarning,
  type UnsavedEntry,
} from "./UnsavedChanges";

const INFERENCE_FIELDS = new Set<keyof Settings>([
  "inference_provider",
  "fireworks_api_key",
  "fireworks_audio_base_url",
  "fireworks_stt_model",
  "fireworks_stt_diarize",
  "fireworks_chat_base_url",
  "fireworks_chat_model",
  "fireworks_stt_cost_per_minute_usd",
  // RAG / Ask provider (Issue #608)
  "rag_provider",
  "rag_local_model",
  // Embedding provider
  "embedding_provider",
  "embedding_model",
  "fireworks_embedding_base_url",
  "fireworks_embedding_model",
  // Diarization (Issue #688) — without these, edits to diarization fields
  // landed in dirtyNotifications, so the Inference-tab Save button (which
  // only flushes dirtyInference) was a silent no-op.
  "diarization_provider",
  "pyannote_api_key",
  "pyannote_cloud_base_url",
  "pyannote_cloud_model",
  "pyannote_cloud_cost_per_second_usd",
  "pyannote_model",
]);

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  // #1069: what the server last confirmed, so Discard has something to
  // return to.
  const [saved, setSaved] = useState<Settings | null>(null);
  const [tab, setTab] = useState("notifications");
  // Unsaved state reported by the tabs that keep their own drafts.
  const [sectionEntries, setSectionEntries] = useState<Record<string, UnsavedEntry>>({});
  const registerSection = useCallback((id: string, entry: UnsavedEntry | null) => {
    setSectionEntries((prev) => {
      if (!entry && !(id in prev)) return prev;
      const next = { ...prev };
      if (entry) next[id] = entry;
      else delete next[id];
      return next;
    });
  }, []);
  const [savingNotifications, setSavingNotifications] = useState(false);
  const [savingInference, setSavingInference] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [dirtyNotifications, setDirtyNotifications] = useState<Partial<Settings>>({});
  const [dirtyInference, setDirtyInference] = useState<Partial<Settings>>({});
  const [shapeError, setShapeError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notifications/settings")
      .then((r) => r.json())
      .then((data) => {
        const parsed = SettingsSchema.safeParse(data);
        if (parsed.success) {
          setSettings(parsed.data);
          setSaved(parsed.data);
          return;
        }
        // Drift between backend allowlist and frontend schema. Surface it
        // visibly instead of writing back a corrupted shape on the next PUT.
        const summary = parsed.error.issues
          .slice(0, 5)
          .map((iss) => `${iss.path.join(".") || "(root)"}: ${iss.message}`)
          .join("; ");
        console.error("settings_shape_mismatch", parsed.error.issues);
        setShapeError(summary);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(id);
  }, [toast]);

  const notificationsDirty = Object.keys(dirtyNotifications).length > 0;
  const inferenceDirty = Object.keys(dirtyInference).length > 0;
  const anyUnsaved =
    notificationsDirty || inferenceDirty || Object.keys(sectionEntries).length > 0;
  useLeaveWarning(anyUnsaved);

  if (shapeError) {
    return (
      <div className="border border-destructive/40 bg-destructive/10 rounded-md p-4 text-sm space-y-2">
        <div className="font-medium text-destructive">
          Settings response shape didn&apos;t match the expected schema.
        </div>
        <div className="text-muted-foreground">
          The backend may have added or changed a field. Refusing to render
          editable fields to avoid corrupting the database on save. Please
          report this with the details below.
        </div>
        <pre className="text-xs bg-muted/40 rounded p-2 overflow-x-auto whitespace-pre-wrap">
          {shapeError}
        </pre>
      </div>
    );
  }

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
        // The response is the whole settings row. Inference edits not yet
        // saved are laid back over it, or they would vanish from the form
        // while still being counted as unsaved.
        setSettings({ ...updated, ...dirtyInference });
        setSaved(updated);
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
        setSettings({ ...updated, ...dirtyNotifications });
        setSaved(updated);
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

  /** Put the named fields back to what the server last confirmed. */
  function revert(fields: Partial<Settings>) {
    if (!saved) return;
    const restored = Object.fromEntries(
      Object.keys(fields).map((key) => [key, saved[key as keyof Settings]])
    );
    setSettings((prev) => (prev ? ({ ...prev, ...restored } as Settings) : prev));
  }

  const entries: UnsavedEntry[] = [
    ...(notificationsDirty
      ? [
          {
            label: "Notifications",
            saving: savingNotifications,
            canSave: true,
            save: handleSaveNotifications,
            discard: () => {
              revert(dirtyNotifications);
              setDirtyNotifications({});
            },
          },
        ]
      : []),
    ...(inferenceDirty
      ? [
          {
            label: "Inference",
            saving: savingInference,
            canSave: true,
            save: handleSaveInference,
            discard: () => {
              revert(dirtyInference);
              setDirtyInference({});
            },
          },
        ]
      : []),
    ...["prompts", "backups"].flatMap((id) =>
      sectionEntries[id] ? [sectionEntries[id]] : []
    ),
  ];

  return (
    // Room at the bottom so the bar never covers the last field.
    <div className={entries.length > 0 ? "pb-24" : undefined}>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure notifications and remote inference providers.
        </p>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        {/* #989: h-10 inline-flex kept four triggers on one unwrappable row,
            which overflowed below ~420px. #1067: letting them wrap left
            three on one row and a lone centred Backups below, so phones get
            an even 2x2 grid instead. From md up it is the usual inline row. */}
        <TabsList className="mb-6 grid h-auto w-full grid-cols-2 md:inline-flex md:w-auto">
          <TabsTrigger value="notifications">Notifications</TabsTrigger>
          <TabsTrigger value="inference">Inference</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
          <TabsTrigger value="backups">Backups</TabsTrigger>
        </TabsList>

        <TabsContent value="notifications">
          <NotificationSection
            settings={settings}
            onChange={handleChange}
            onTest={handleTest}
            testing={testing}
          />
        </TabsContent>

        <TabsContent value="inference">
          <RemoteInferenceSection settings={settings} onChange={handleChange} />
        </TabsContent>

        {/* #1069: Prompts and Backups hold their drafts themselves, so
            unmounting them on a tab switch silently threw unsaved edits
            away. They stay mounted and are hidden instead. */}
        <UnsavedChangesContext.Provider value={registerSection}>
          <TabsContent value="prompts" forceMount hidden={tab !== "prompts"}>
            <PromptsSection />
          </TabsContent>

          <TabsContent value="backups" forceMount hidden={tab !== "backups"}>
            <BackupsSection />
          </TabsContent>
        </UnsavedChangesContext.Provider>
      </Tabs>

      <UnsavedChangesBar entries={entries} />

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
