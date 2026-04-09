"use client";

import { useEffect, useState } from "react";

import {
  EmailTab,
  FireworksTab,
  GeneralTab,
  Settings,
  Tab,
  TelegramTab,
  Toast,
} from "./NotificationSettingsSections";

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("telegram");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
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
    return <div className="text-muted-foreground text-sm">Loading settings...</div>;
  }

  function handleChange(field: keyof Settings, value: string | number | boolean | null) {
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

  const tabs: { key: Tab; label: string; dot?: boolean; configured?: boolean }[] = [
    { key: "telegram", label: "Telegram", dot: true, configured: settings.telegram_configured },
    { key: "email", label: "Email", dot: true, configured: !!settings.notification_email_to },
    { key: "general", label: "General" },
    { key: "fireworks", label: "Fireworks AI", dot: true, configured: settings.fireworks_configured },
  ];

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-semibold">Settings</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure notifications and optional advanced provider settings.
        </p>
      </div>
      <div className="flex border-b border-border mb-6" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            role="tab"
            aria-selected={activeTab === tab.key}
            className={`px-5 py-2.5 text-sm border-b-2 transition-colors ${
              activeTab === tab.key
                ? "border-indigo-500 text-foreground font-medium"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
            onClick={() => setActiveTab(tab.key)}
          >
            {tab.label}
            {tab.dot && (
              <span
                className={`inline-block w-1.5 h-1.5 rounded-full ml-1.5 ${
                  tab.configured ? "bg-green-500" : "bg-muted-foreground"
                }`}
              />
            )}
          </button>
        ))}
      </div>

      {activeTab === "telegram" && (
        <TelegramTab
          settings={settings}
          onChange={handleChange}
          onSave={handleSave}
          onTest={() => handleTest("telegram")}
          saving={saving}
          testing={testing}
        />
      )}
      {activeTab === "email" && (
        <EmailTab
          settings={settings}
          onChange={handleChange}
          onSave={handleSave}
          onTest={() => handleTest("email")}
          saving={saving}
          testing={testing}
        />
      )}
      {activeTab === "general" && (
        <GeneralTab
          settings={settings}
          onChange={handleChange}
          onSave={handleSave}
          saving={saving}
        />
      )}
      {activeTab === "fireworks" && (
        <FireworksTab
          settings={settings}
          onChange={handleChange}
          onSave={handleSave}
          saving={saving}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
