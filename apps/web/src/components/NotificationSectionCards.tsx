"use client";

import { useState, useEffect, type KeyboardEvent, type ReactNode } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import type { Settings } from "./NotificationSettingsSections";

interface NotificationSectionSharedProps {
  settings: Settings;
  onChange: (field: keyof Settings, value: string | number | boolean | null) => void;
  onTest: (channel: "telegram" | "email") => void;
  testing: boolean;
}

function StatusBadge({ configured }: { configured: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full ${
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
    ? value
        .split(",")
        .map((e) => e.trim().toLowerCase())
        .filter(Boolean)
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
    onChange([...emails, email].join(", "));
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
            className="inline-flex items-center gap-1 bg-muted text-foreground text-xs px-2 py-1 rounded-md"
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
          placeholder={
            emails.length === 0
              ? "Add email address and press Enter"
              : "Add email and press Enter"
          }
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

function SetupGuide({
  title,
  configured,
  children,
}: {
  title: string;
  configured: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(!configured);

  useEffect(() => {
    setOpen(!configured);
  }, [configured]);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border border-border bg-muted/50 p-4 mb-6">
        <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <span className="text-xs text-muted-foreground">
            {open ? "Hide" : "Show"}
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>{children}</CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function TelegramNotificationCard({
  settings,
  onChange,
  onTest,
  testing,
}: NotificationSectionSharedProps) {
  return (
    <div className="rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium">Telegram</h3>
        <StatusBadge configured={settings.telegram_configured} />
      </div>

      <SetupGuide
        title="How to set up Telegram notifications"
        configured={settings.telegram_configured}
      >
        <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            Open Telegram and search for <strong>@BotFather</strong>
          </li>
          <li>
            Send <code className="bg-muted px-1 rounded text-xs">/newbot</code>{" "}
            and follow the prompts to create a bot
          </li>
          <li>
            Copy the <strong>bot token</strong> (looks like{" "}
            <code className="bg-muted px-1 rounded text-xs">
              123456:ABC-DEF...
            </code>
            ) and paste it below
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
      </SetupGuide>

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

      <button
        className="px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50 mt-2"
        onClick={() => onTest("telegram")}
        disabled={!settings.telegram_configured || testing}
      >
        {testing ? "Sending..." : "Send test message"}
      </button>
    </div>
  );
}

export function EmailNotificationCard({
  settings,
  onChange,
  onTest,
  testing,
}: NotificationSectionSharedProps) {
  const [smtpOpen, setSmtpOpen] = useState(false);

  return (
    <div className="rounded-lg border border-border p-6">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-base font-medium">Email</h3>
        <StatusBadge configured={!!settings.notification_email_to} />
      </div>

      <SetupGuide
        title="How to set up email notifications"
        configured={settings.email_configured}
      >
        <ol className="mt-3 ml-5 list-decimal space-y-2 text-sm text-muted-foreground">
          <li>
            If you have a local mail server (postfix, sendmail), just enter
            your email address below and Save — the defaults will work
          </li>
          <li>
            For external providers (Gmail, Fastmail, etc.), expand &quot;SMTP
            Configuration&quot; below
          </li>
          <li>
            For <strong>Gmail</strong>: enable 2FA, then create an App Password
            in Google account settings. Use{" "}
            <code className="bg-muted px-1 rounded text-xs">
              smtp.gmail.com
            </code>{" "}
            port <code className="bg-muted px-1 rounded text-xs">587</code>{" "}
            with TLS enabled
          </li>
          <li>
            For other providers, check their SMTP documentation for
            host/port/TLS settings
          </li>
        </ol>
      </SetupGuide>

      <FieldGroup
        label="Send to"
        hint="Email addresses that receive notifications"
      >
        <EmailTagInput
          value={settings.notification_email_to}
          onChange={(val) => onChange("notification_email_to", val)}
        />
      </FieldGroup>

      <FieldGroup
        label="From address"
        hint="Sender address shown in notifications"
      >
        <input
          id="from-address"
          type="email"
          className={inputClass}
          placeholder="podlog@localhost"
          value={settings.notification_email_from}
          onChange={(e) => onChange("notification_email_from", e.target.value)}
        />
      </FieldGroup>

      <Collapsible open={smtpOpen} onOpenChange={setSmtpOpen}>
        <div className="border-t border-border my-4" />
        <CollapsibleTrigger className="flex w-full items-center justify-between text-left text-sm mb-4">
          <span className="font-medium">SMTP Configuration</span>
          <span className="text-xs text-muted-foreground">
            {smtpOpen ? "Hide" : "Show"} — optional, defaults work with local
            mail servers
          </span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="space-y-4 mb-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FieldGroup
                label="SMTP Host"
                hint="Leave default for local, or e.g. smtp.gmail.com"
              >
                <input
                  id="smtp-host"
                  type="text"
                  className={inputClass}
                  placeholder="host.docker.internal"
                  value={settings.smtp_host}
                  onChange={(e) => onChange("smtp_host", e.target.value)}
                />
              </FieldGroup>
              <FieldGroup
                label="SMTP Port"
                hint="25 for local, 587 for TLS, 465 for SSL"
              >
                <input
                  id="smtp-port"
                  type="number"
                  className={inputClass}
                  placeholder="25"
                  value={settings.smtp_port}
                  onChange={(e) =>
                    onChange("smtp_port", parseInt(e.target.value, 10) || 0)
                  }
                />
              </FieldGroup>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
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
              <FieldGroup
                label="SMTP Password"
                hint="App password or SMTP credential"
              >
                <input
                  id="smtp-password"
                  type="password"
                  className={inputClass}
                  placeholder=""
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
        </CollapsibleContent>
      </Collapsible>

      <button
        className="px-4 py-2 rounded-md border border-border text-sm text-muted-foreground hover:text-foreground hover:border-muted-foreground disabled:opacity-50 mt-2"
        onClick={() => onTest("email")}
        disabled={!settings.notification_email_to || testing}
      >
        {testing ? "Sending..." : "Send test email"}
      </button>
    </div>
  );
}

export function GeneralNotificationCard({
  settings,
  onChange,
}: Omit<NotificationSectionSharedProps, "onTest" | "testing">) {
  return (
    <div className="rounded-lg border border-border p-6">
      <h3 className="text-base font-medium mb-4">General</h3>

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
          <option value="immediate">
            Immediate — notify after each episode
          </option>
          <option value="daily">
            Daily digest — summary at 8:00 AM UTC
          </option>
          <option value="weekly">
            Weekly digest — summary on Monday at 8:00 AM UTC
          </option>
        </select>
      </FieldGroup>

      <div className="border-t border-border my-4" />

      <FieldGroup
        label="Health Check Notifications"
        hint="Host-level monitoring alerts (service status, zombie jobs). Runs via cron every 15 minutes."
      >
        <label className="flex items-center gap-2 text-sm mt-2">
          <input
            type="checkbox"
            checked={settings.health_check_notifications_enabled}
            onChange={(e) =>
              onChange("health_check_notifications_enabled", e.target.checked)
            }
          />
          Send Telegram alerts when services go down or jobs get stuck
        </label>
      </FieldGroup>
    </div>
  );
}
