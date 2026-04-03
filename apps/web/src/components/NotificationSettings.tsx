"use client";

import { useState, useEffect } from "react";

// --- Types ---

interface Settings {
  telegram_bot_token: string | null;
  telegram_chat_id: string | null;
  notification_email_to: string | null;
  notification_email_from: string;
  smtp_host: string;
  smtp_port: number;
  smtp_user: string | null;
  smtp_password: string | null;
  smtp_use_tls: boolean;
  notification_frequency: string;
  telegram_configured: boolean;
  email_configured: boolean;
}

type Tab = "telegram" | "email" | "general";

// --- Setup Guides ---

function TelegramGuide({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(!configured);

  useEffect(() => {
    setOpen(!configured);
  }, [configured]);

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4 mb-6">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(!open)}
      >
        <h3 className="text-sm font-medium text-indigo-400">
          How to set up Telegram notifications
        </h3>
        <span className="text-xs text-indigo-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            Open Telegram and search for <strong>@BotFather</strong>
          </li>
          <li>
            Send <code className="bg-muted px-1 rounded text-xs">/newbot</code> and follow the
            prompts to create a bot
          </li>
          <li>
            Copy the <strong>bot token</strong> (looks like{" "}
            <code className="bg-muted px-1 rounded text-xs">123456:ABC-DEF...</code>) and paste it
            below
          </li>
          <li>Start a chat with your new bot (send it any message)</li>
          <li>
            Visit{" "}
            <code className="bg-muted px-1 rounded text-xs">
              {"https://api.telegram.org/bot<TOKEN>/getUpdates"}
            </code>{" "}
            in your browser
          </li>
          <li>
            Find{" "}
            <code className="bg-muted px-1 rounded text-xs">
              {'"chat":{"id":123456789}'}
            </code>{" "}
            in the response — that&apos;s your <strong>Chat ID</strong>
          </li>
        </ol>
      )}
    </div>
  );
}

function EmailGuide({ configured }: { configured: boolean }) {
  const [open, setOpen] = useState(!configured);

  useEffect(() => {
    setOpen(!configured);
  }, [configured]);

  return (
    <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-4 mb-6">
      <button
        className="flex w-full items-center justify-between text-left"
        onClick={() => setOpen(!open)}
      >
        <h3 className="text-sm font-medium text-indigo-400">
          How to set up email notifications
        </h3>
        <span className="text-xs text-indigo-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            If you have a local mail server (postfix, sendmail), just enter your email address
            below and Save — the defaults will work
          </li>
          <li>
            For external providers (Gmail, Fastmail, etc.), expand &quot;SMTP Configuration&quot;
            below
          </li>
          <li>
            For <strong>Gmail</strong>: enable 2FA, then create an App Password in Google account
            settings. Use <code className="bg-muted px-1 rounded text-xs">smtp.gmail.com</code>{" "}
            port <code className="bg-muted px-1 rounded text-xs">587</code> with TLS enabled
          </li>
          <li>For other providers, check their SMTP documentation for host/port/TLS settings</li>
        </ol>
      )}
    </div>
  );
}

// --- Sub-components ---

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full mb-4 ${
        configured
          ? "bg-green-500/10 text-green-500"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <span
        className={`w-1.5 h-1.5 rounded-full ${
          configured ? "bg-green-500" : "bg-muted-foreground"
        }`}
      />
      {configured ? "Configured" : "Not configured"}
    </span>
  );
}

function Toast({ message, type }: { message: string; type: "success" | "error" }) {
  return (
    <div
      className={`fixed bottom-6 right-6 z-50 flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm text-white shadow-lg ${
        type === "success" ? "bg-green-600" : "bg-red-600"
      }`}
    >
      {type === "success" ? "✓" : "✕"} {message}
    </div>
  );
}

function FieldGroup({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  const id = label.toLowerCase().replace(/\s+/g, "-");
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium mb-1">
        {label}
      </label>
      {hint && <p className="text-xs text-muted-foreground mb-1.5">{hint}</p>}
      {children}
    </div>
  );
}

const inputClass =
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring";

const EMAIL_RE = /^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/;

function EmailTagInput({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
}) {
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);

  const emails = value
    ? value.split(",").map((e) => e.trim().toLowerCase()).filter(Boolean)
    : [];

  function addEmail(raw: string) {
    const email = raw.trim().toLowerCase();
    if (!email) return;

    if (!EMAIL_RE.test(email)) {
      setError("Invalid email address");
      return;
    }
    if (emails.includes(email)) {
      setError("Already added");
      return;
    }

    setError(null);
    setInput("");
    const next = [...emails, email];
    onChange(next.join(", "));
  }

  function removeEmail(email: string) {
    const next = emails.filter((e) => e !== email);
    onChange(next.length > 0 ? next.join(", ") : null);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      addEmail(input);
    }
    if (e.key === "Backspace" && !input && emails.length > 0) {
      removeEmail(emails[emails.length - 1]);
    }
  }

  return (
    <div>
      <div
        className={`flex flex-wrap gap-1.5 items-center min-h-[42px] w-full rounded-md border border-border bg-background px-2 py-1.5 focus-within:ring-1 focus-within:ring-ring ${
          error ? "border-red-500" : ""
        }`}
      >
        {emails.map((email) => (
          <span
            key={email}
            className="inline-flex items-center gap-1 bg-indigo-500/15 text-indigo-400 text-xs px-2 py-1 rounded-md"
          >
            {email}
            <button
              type="button"
              aria-label={`Remove ${email}`}
              className="hover:text-red-400 text-xs leading-none"
              onClick={() => removeEmail(email)}
            >
              x
            </button>
          </span>
        ))}
        <input
          type="text"
          className="flex-1 min-w-[180px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-none py-1"
          placeholder={emails.length === 0 ? "Add email address and press Enter" : "Add email and press Enter"}
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            setError(null);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => {
            if (input.trim()) addEmail(input);
          }}
        />
      </div>
      {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
}

// --- Tab Content ---

function TelegramTab({
  settings,
  onChange,
  onSave,
  onTest,
  saving,
  testing,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testing: boolean;
}) {
  return (
    <div>
      <StatusBadge configured={settings.telegram_configured} />
      <TelegramGuide configured={settings.telegram_configured} />

      <FieldGroup
        label="Bot Token"
        hint="The token you received from @BotFather when creating your bot"
      >
        <input
          id="bot-token"
          type="password"
          className={inputClass}
          placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
          value={settings.telegram_bot_token ?? ""}
          onChange={(e) => onChange("telegram_bot_token", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Chat ID"
        hint="Your personal chat ID — find it via the getUpdates API call above"
      >
        <input
          id="chat-id"
          type="text"
          className={inputClass}
          placeholder="123456789"
          value={settings.telegram_chat_id ?? ""}
          onChange={(e) => onChange("telegram_chat_id", e.target.value)}
        />
      </FieldGroup>

      <div className="flex gap-3 mt-6">
        <button
          className="px-5 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          className="px-5 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50"
          onClick={onTest}
          disabled={!settings.telegram_configured || testing}
        >
          {testing ? "Sending..." : "Send test message"}
        </button>
      </div>
    </div>
  );
}

function EmailTab({
  settings,
  onChange,
  onSave,
  onTest,
  saving,
  testing,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string | number | boolean | null) => void;
  onSave: () => void;
  onTest: () => void;
  saving: boolean;
  testing: boolean;
}) {
  const [smtpOpen, setSmtpOpen] = useState(false);

  return (
    <div>
      <StatusBadge configured={!!settings.notification_email_to} />
      <EmailGuide configured={settings.email_configured} />

      <FieldGroup label="Send to" hint="Email addresses that receive notifications">
        <EmailTagInput
          value={settings.notification_email_to}
          onChange={(val) => onChange("notification_email_to", val)}
        />
      </FieldGroup>

      <FieldGroup label="From address" hint="Sender address shown in notifications">
        <input
          id="from-address"
          type="email"
          className={inputClass}
          placeholder="podlog@localhost"
          value={settings.notification_email_from}
          onChange={(e) => onChange("notification_email_from", e.target.value)}
        />
      </FieldGroup>

      <div className="border-t border-border my-6" />

      <button
        className="flex w-full items-center justify-between text-left text-sm mb-4"
        onClick={() => setSmtpOpen(!smtpOpen)}
      >
        <span className="font-medium">SMTP Configuration</span>
        <span className="text-xs text-muted-foreground">
          {smtpOpen ? "Hide" : "Show"} — optional, defaults work with local mail servers
        </span>
      </button>

      {smtpOpen && (
        <div className="space-y-4 mb-4">
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup label="SMTP Host" hint="Leave default for local, or e.g. smtp.gmail.com">
              <input
                id="smtp-host"
                type="text"
                className={inputClass}
                placeholder="host.docker.internal"
                value={settings.smtp_host}
                onChange={(e) => onChange("smtp_host", e.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="SMTP Port" hint="25 for local, 587 for TLS, 465 for SSL">
              <input
                id="smtp-port"
                type="number"
                className={inputClass}
                placeholder="25"
                value={settings.smtp_port}
                onChange={(e) => onChange("smtp_port", parseInt(e.target.value) || 0)}
              />
            </FieldGroup>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <FieldGroup
              label="SMTP Username"
              hint="Usually your email address — leave empty for local"
            >
              <input
                id="smtp-username"
                type="text"
                className={inputClass}
                placeholder="you@example.com"
                value={settings.smtp_user ?? ""}
                onChange={(e) => onChange("smtp_user", e.target.value)}
              />
            </FieldGroup>
            <FieldGroup label="SMTP Password" hint="App password or SMTP credential">
              <input
                id="smtp-password"
                type="password"
                className={inputClass}
                placeholder="••••••••"
                value={settings.smtp_password ?? ""}
                onChange={(e) => onChange("smtp_password", e.target.value)}
              />
            </FieldGroup>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={settings.smtp_use_tls}
              onChange={(e) => onChange("smtp_use_tls", e.target.checked)}
            />
            Enable TLS
            <span className="text-xs text-muted-foreground">
              — required for Gmail, Outlook, and most external providers
            </span>
          </label>
        </div>
      )}

      <div className="flex gap-3 mt-6">
        <button
          className="px-5 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          className="px-5 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50"
          onClick={onTest}
          disabled={!settings.notification_email_to || testing}
        >
          {testing ? "Sending..." : "Send test email"}
        </button>
      </div>
    </div>
  );
}

function GeneralTab({
  settings,
  onChange,
  onSave,
  saving,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div>
      <FieldGroup
        label="Notification Frequency"
        hint="Controls success notifications. Failures are always sent immediately."
      >
        <select
          id="notification-frequency"
          className={inputClass}
          value={settings.notification_frequency}
          onChange={(e) => onChange("notification_frequency", e.target.value)}
        >
          <option value="immediate">Immediate — notify after each episode</option>
          <option value="daily">Daily digest — summary at 8:00 AM UTC</option>
          <option value="weekly">Weekly digest — summary on Monday at 8:00 AM UTC</option>
        </select>
      </FieldGroup>

      <div className="flex gap-3 mt-6">
        <button
          className="px-5 py-2 rounded-md bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
          onClick={onSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}

// --- Main Component ---

export default function NotificationSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("telegram");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);

  // Track which fields have been changed (to send only dirty fields on save)
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
    { key: "email", label: "Email", dot: true, configured: settings.email_configured },
    { key: "general", label: "General" },
  ];

  return (
    <div>
      {/* Tabs */}
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

      {/* Tab content */}
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

      {/* Toast */}
      {toast && <Toast message={toast.message} type={toast.type} />}
    </div>
  );
}
