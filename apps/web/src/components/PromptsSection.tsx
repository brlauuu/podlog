"use client";

import { useEffect, useState } from "react";

interface PromptItem {
  key: string;
  label: string;
  description: string;
  value: string;
  default: string;
  is_overridden: boolean;
  updated_at: string | null;
}

interface ToastMsg {
  message: string;
  type: "success" | "error";
}

export default function PromptsSection() {
  const [prompts, setPrompts] = useState<PromptItem[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastMsg | null>(null);

  async function load() {
    try {
      const resp = await fetch("/api/prompts", { cache: "no-store" });
      const data = await resp.json();
      setPrompts(data.prompts ?? []);
      setDrafts({});
    } catch {
      setToast({ message: "Failed to load prompts", type: "error" });
    }
  }

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(id);
  }, [toast]);

  async function save(p: PromptItem) {
    const value = drafts[p.key] ?? p.value;
    if (!value.trim()) {
      setToast({ message: "Prompt cannot be empty", type: "error" });
      return;
    }
    setBusyKey(p.key);
    try {
      const resp = await fetch(`/api/prompts/${encodeURIComponent(p.key)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setToast({ message: err.detail || "Save failed", type: "error" });
        return;
      }
      await load();
      setToast({ message: "Prompt saved", type: "success" });
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setBusyKey(null);
    }
  }

  async function reset(p: PromptItem) {
    setBusyKey(p.key);
    try {
      const resp = await fetch(
        `/api/prompts/${encodeURIComponent(p.key)}/reset`,
        { method: "POST" }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        setToast({ message: err.detail || "Reset failed", type: "error" });
        return;
      }
      await load();
      setToast({ message: "Reset to default", type: "success" });
    } catch {
      setToast({ message: "Network error", type: "error" });
    } finally {
      setBusyKey(null);
    }
  }

  if (prompts === null) {
    return <div className="text-muted-foreground text-sm">Loading prompts...</div>;
  }

  return (
    <div className="space-y-8">
      <p className="text-sm text-muted-foreground">
        System prompts sent to the LLM at the start of each chat. Build-time
        defaults come from environment variables; saved overrides live in the
        database. &ldquo;Reset to default&rdquo; clears the override and falls
        back to the env-var value.
      </p>

      {prompts.map((p) => {
        const draft = drafts[p.key];
        const current = draft ?? p.value;
        const dirty = draft !== undefined && draft !== p.value;
        const busy = busyKey === p.key;
        return (
          <div key={p.key} className="border rounded-md p-4 space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium text-sm flex items-center gap-2">
                  {p.label}
                  {p.is_overridden && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      modified
                    </span>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {p.description}
                </div>
                <div className="text-[11px] text-muted-foreground mt-1 font-mono">
                  key: {p.key}
                </div>
              </div>
            </div>

            <textarea
              className="w-full min-h-[180px] text-sm font-mono rounded-md border bg-background p-2"
              value={current}
              onChange={(e) =>
                setDrafts((prev) => ({ ...prev, [p.key]: e.target.value }))
              }
              disabled={busy}
              spellCheck={false}
            />

            <div className="flex gap-2">
              <button
                className="px-4 py-1.5 rounded-md bg-action text-action-foreground text-sm font-medium hover:bg-action/90 disabled:opacity-50"
                onClick={() => save(p)}
                disabled={busy || !dirty}
              >
                {busy ? "Saving..." : "Save"}
              </button>
              <button
                className="px-4 py-1.5 rounded-md border text-sm hover:bg-muted disabled:opacity-50"
                onClick={() => reset(p)}
                disabled={busy || !p.is_overridden}
                title={
                  p.is_overridden
                    ? "Delete the override and use the env-var default"
                    : "Already using the env-var default"
                }
              >
                Reset to default
              </button>
            </div>
          </div>
        );
      })}

      {toast && (
        <div
          className={`fixed bottom-6 right-6 px-4 py-2 rounded-md shadow-lg text-sm ${
            toast.type === "success"
              ? "bg-green-600 text-white"
              : "bg-destructive text-destructive-foreground"
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}
