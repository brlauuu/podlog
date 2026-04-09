"use client";

import { useEffect, useState, type KeyboardEvent, type ReactNode } from "react";

export interface Settings {
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
  health_check_notifications_enabled: boolean;
  inference_provider: "local" | "fireworks";
  fireworks_api_key: string | null;
  fireworks_audio_base_url: string;
  fireworks_stt_model: string;
  fireworks_stt_diarize: boolean;
  fireworks_chat_base_url: string;
  fireworks_chat_model: string;
  fireworks_stt_cost_per_minute_usd: number;
  embedding_provider: "local" | "fireworks";
  embedding_model: string;
  fireworks_embedding_base_url: string;
  fireworks_embedding_model: string;
  telegram_configured: boolean;
  email_configured: boolean;
  fireworks_configured: boolean;
}

export type Tab = "telegram" | "email" | "general" | "fireworks";

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

function FireworksGuide({ configured }: { configured: boolean }) {
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
          How to enable Fireworks AI processing
        </h3>
        <span className="text-xs text-indigo-400">{open ? "Hide" : "Show"}</span>
      </button>
      {open && (
        <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>Create a Fireworks API key from your Fireworks account.</li>
          <li>
            Option A (UI): paste the key below, set provider to <strong>Fireworks AI</strong>, and
            save settings.
          </li>
          <li>
            Option B (env vars): set <code className="bg-muted px-1 rounded text-xs">INFERENCE_PROVIDER=fireworks</code>{" "}
            and <code className="bg-muted px-1 rounded text-xs">FIREWORKS_API_KEY=...</code>.
          </li>
          <li>Queue or retry episodes to process them through the Fireworks pipeline.</li>
          <li>Provider changes are applied at task runtime (no restart required).</li>
          <li>
            Keep provider as <strong>Local</strong> anytime you want fully local processing again.
          </li>
        </ol>
      )}
    </div>
  );
}

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

export function Toast({ message, type }: { message: string; type: "success" | "error" }) {
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
  children: ReactNode;
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
  "w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-hidden focus:ring-1 focus:ring-ring";

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

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
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
          className="flex-1 min-w-[180px] bg-transparent text-sm text-foreground placeholder:text-muted-foreground outline-hidden py-1"
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

export function TelegramTab({
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

export function EmailTab({
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
                onChange={(e) => onChange("smtp_port", parseInt(e.target.value, 10) || 0)}
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

export function GeneralTab({
  settings,
  onChange,
  onSave,
  saving,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string | boolean) => void;
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

      <div className="border-t border-border my-6" />

      <FieldGroup
        label="Health Check Notifications"
        hint="Host-level monitoring alerts (service status, zombie jobs). Runs via cron every 15 minutes."
      >
        <label className="flex items-center gap-2 text-sm mt-2">
          <input
            type="checkbox"
            checked={settings.health_check_notifications_enabled}
            onChange={(e) => onChange("health_check_notifications_enabled", e.target.checked)}
          />
          Send Telegram alerts when services go down or jobs get stuck
        </label>
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

export function FireworksTab({
  settings,
  onChange,
  onSave,
  saving,
}: {
  settings: Settings;
  onChange: (field: keyof Settings, value: string | number | boolean | null) => void;
  onSave: () => void;
  saving: boolean;
}) {
  return (
    <div>
      <StatusBadge configured={settings.fireworks_configured} />
      <FireworksGuide configured={settings.fireworks_configured} />

      <FieldGroup
        label="Inference Provider"
        hint="Use local for current behavior, or fireworks to enable remote inference."
      >
        <select
          id="inference-provider"
          className={inputClass}
          value={settings.inference_provider}
          onChange={(e) => onChange("inference_provider", e.target.value)}
        >
          <option value="local">Local</option>
          <option value="fireworks">Fireworks AI</option>
        </select>
      </FieldGroup>

      <FieldGroup
        label="Embedding Provider"
        hint="Controls query + segment/chunk embedding generation."
      >
        <select
          id="embedding-provider"
          className={inputClass}
          value={settings.embedding_provider}
          onChange={(e) => onChange("embedding_provider", e.target.value)}
        >
          <option value="local">Local</option>
          <option value="fireworks">Fireworks AI</option>
        </select>
      </FieldGroup>

      <FieldGroup
        label="Local Embedding Model"
        hint="Sentence-transformers model used when Embedding Provider is local."
      >
        <input
          id="embedding-model"
          type="text"
          className={inputClass}
          value={settings.embedding_model}
          onChange={(e) => onChange("embedding_model", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup label="Fireworks API Key" hint="Stored in Podlog settings and masked on read.">
        <input
          id="fireworks-api-key"
          type="password"
          className={inputClass}
          placeholder="fw_..."
          value={settings.fireworks_api_key ?? ""}
          onChange={(e) => onChange("fireworks_api_key", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="STT Model"
        hint="Fireworks speech model. Example: whisper-v3-large."
      >
        <input
          id="fireworks-stt-model"
          type="text"
          className={inputClass}
          value={settings.fireworks_stt_model}
          onChange={(e) => onChange("fireworks_stt_model", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Audio Base URL"
        hint="Speech endpoint base. Keep default unless you have a custom route."
      >
        <input
          id="fireworks-audio-base-url"
          type="text"
          className={inputClass}
          value={settings.fireworks_audio_base_url}
          onChange={(e) => onChange("fireworks_audio_base_url", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Chat Base URL"
        hint="Generation endpoint base used by Ask when Inference Provider is fireworks."
      >
        <input
          id="fireworks-chat-base-url"
          type="text"
          className={inputClass}
          value={settings.fireworks_chat_base_url}
          onChange={(e) => onChange("fireworks_chat_base_url", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Fireworks Chat Model"
        hint="Remote chat model used for Ask generation in fireworks mode."
      >
        <input
          id="fireworks-chat-model"
          type="text"
          className={inputClass}
          value={settings.fireworks_chat_model}
          onChange={(e) => onChange("fireworks_chat_model", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Embeddings Base URL"
        hint="Embeddings endpoint base. Keep default unless you have a custom route."
      >
        <input
          id="fireworks-embedding-base-url"
          type="text"
          className={inputClass}
          value={settings.fireworks_embedding_base_url}
          onChange={(e) => onChange("fireworks_embedding_base_url", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Fireworks Embedding Model"
        hint="Remote embedding model used when Embedding Provider is fireworks."
      >
        <input
          id="fireworks-embedding-model"
          type="text"
          className={inputClass}
          value={settings.fireworks_embedding_model}
          onChange={(e) => onChange("fireworks_embedding_model", e.target.value)}
        />
      </FieldGroup>

      <FieldGroup
        label="Diarization"
        hint="Enable speaker diarization for Fireworks transcription requests."
      >
        <label className="flex items-center gap-2 text-sm mt-2">
          <input
            type="checkbox"
            checked={settings.fireworks_stt_diarize}
            onChange={(e) => onChange("fireworks_stt_diarize", e.target.checked)}
          />
          Enable diarization
        </label>
      </FieldGroup>

      <FieldGroup
        label="STT Cost Rate (USD / minute)"
        hint="Used only for cost estimates shown in episode observability."
      >
        <input
          id="fireworks-stt-cost-per-minute-usd"
          type="number"
          className={inputClass}
          step="0.0001"
          min="0"
          value={settings.fireworks_stt_cost_per_minute_usd}
          onChange={(e) => {
            const raw = Number(e.target.value);
            onChange("fireworks_stt_cost_per_minute_usd", Number.isFinite(raw) ? raw : 0);
          }}
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
      </div>
    </div>
  );
}
