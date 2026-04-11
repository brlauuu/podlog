"use client";

import { useEffect, useState } from "react";
import { Separator } from "@/components/ui/separator";
import { Settings, Toast } from "./NotificationSettingsSections";
import NotificationSection from "./NotificationSection";
import RemoteInferenceSection from "./RemoteInferenceSection";

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{
    message: string;
    type: "success" | "error";
  } | null>(null);
  const [dirty, setDirty] = useState<Partial<Settings>>({});

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
    setDirty((prev) => ({ ...prev, [field]: value }));
  }

  async function handleSave() {
    if (Object.keys(dirty).length === 0) return;
    setSaving(true);
    try {
      const resp = await fetch("/api/notifications/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(dirty),
      });
      if (resp.ok) {
        const updated = await resp.json();
        setSettings(updated);
        setDirty({});
        if (updated.fireworks_key_warning) {
          setToast({
            message: updated.fireworks_key_warning,
            type: "error",
          });
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
      setSaving(false);
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

      {/* Section 1: Notifications */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Notifications</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Configure how and when Podlog sends you notifications about processed
          episodes and system health.
        </p>
        <NotificationSection
          settings={settings}
          onChange={handleChange}
          onTest={handleTest}
          testing={testing}
        />
      </section>

      <Separator className="my-8" />

      {/* Section 2: Remote Inference */}
      <section>
        <h2 className="text-lg font-semibold mb-1">Remote Inference</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Configure which pipeline steps run locally and which use a remote
          provider for faster processing.
        </p>
        <RemoteInferenceSection settings={settings} onChange={handleChange} />
      </section>

      {/* Single Save button */}
      <div className="flex gap-3 mt-8 mb-4">
        <button
          className={actionButtonClass}
          onClick={handleSave}
          disabled={saving || Object.keys(dirty).length === 0}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
