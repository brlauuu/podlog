"use client";

import { useEffect, useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Toast } from "./NotificationSettingsSections";
import { SettingsSchema } from "@/lib/settings-schema";
import NotificationSection from "./NotificationSection";
import RemoteInferenceSection from "./RemoteInferenceSection";

// Fields edited from the Remote Inference tab. handleChange routes any field
// in this Set into dirtyInference (saved by that tab's Save button); other
// fields go into dirtyNotifications. Any field rendered by RemoteInferenceSection
// must be listed here, otherwise the Inference Save button stays disabled and
// the user's change appears to be silently dropped.
//
// Keep in lockstep with apps/pipeline/app/services/notification_settings.py
// (_INFERENCE_FIELDS, _EMBEDDING_FIELDS, _DIARIZATION_FIELDS) for fields that
// have a backend twin. The regression test in tests/unit/notification-settings-routing.test.tsx
// pins the relationship.
const INFERENCE_FIELDS = new Set<keyof Settings>([
  // Transcription provider
  "inference_provider",
  "fireworks_api_key",
  "fireworks_audio_base_url",
  "fireworks_stt_model",
  "fireworks_stt_diarize",
  "fireworks_chat_base_url",
  "fireworks_chat_model",
  "fireworks_stt_cost_per_minute_usd",
  // Chunked transcription (Issue #610)
  "fireworks_chunked_transcription_enabled",
  "fireworks_chunk_target_secs",
  "fireworks_chunk_overlap_secs",
  "fireworks_chunk_max_retries",
  // Embedding provider
  "embedding_provider",
  "embedding_model",
  "fireworks_embedding_base_url",
  "fireworks_embedding_model",
  // Diarization provider (Issue #516)
  "diarization_provider",
  "pyannote_api_key",
  "pyannote_cloud_base_url",
  "pyannote_cloud_model",
  "pyannote_cloud_cost_per_second_usd",
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
  const [shapeError, setShapeError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/notifications/settings")
      .then((r) => r.json())
      .then((data) => {
        const parsed = SettingsSchema.safeParse(data);
        if (parsed.success) {
          setSettings(parsed.data);
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
