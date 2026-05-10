"use client";

import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

type PendingDelete =
  | { kind: "db"; tier: "daily" | "weekly" | "monthly"; filename: string; size: number; date: string }
  | { kind: "audio"; date: string; size: number };

interface DbDump {
  date: string;
  filename: string;
  size_bytes: number;
}

interface AudioSnapshot {
  date: string;
  size_bytes: number;
}

interface Retention {
  daily: number;
  weekly: number;
  monthly: number;
}

interface BackupsResponse {
  enabled: boolean;
  mounted: boolean;
  retention: Retention;
  last_run: string | null;
  db: { daily: DbDump[]; weekly: DbDump[]; monthly: DbDump[] };
  audio: AudioSnapshot[];
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v.toFixed(v < 10 ? 1 : 0)} ${units[i]}`;
}

function DbTier({
  label,
  tier,
  retention,
  dumps,
  onRequestDelete,
}: {
  label: string;
  tier: "daily" | "weekly" | "monthly";
  retention: number;
  dumps: DbDump[];
  onRequestDelete: (target: PendingDelete) => void;
}) {
  const heading = retention === 0
    ? `${label} — disabled`
    : `${label} — ${dumps.length} of ${retention} kept`;

  return (
    <div>
      <h4 className="text-sm font-medium mb-2">{heading}</h4>
      {dumps.length === 0 ? (
        <p className="text-sm text-muted-foreground">No backups yet.</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {dumps.map((d) => (
            <li
              key={d.filename}
              className="flex items-center justify-between gap-2 font-mono"
            >
              <span>{d.date}</span>
              <span className="flex items-center gap-2">
                <span className="text-muted-foreground">{formatBytes(d.size_bytes)}</span>
                <button
                  type="button"
                  className="text-xs text-destructive hover:underline disabled:opacity-50"
                  onClick={() =>
                    onRequestDelete({
                      kind: "db",
                      tier,
                      filename: d.filename,
                      date: d.date,
                      size: d.size_bytes,
                    })
                  }
                  aria-label={`Delete ${tier} dump for ${d.date}`}
                >
                  Delete
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RetentionEditor({
  initial,
  onSaved,
}: {
  initial: Retention;
  onSaved: (next: Retention) => void;
}) {
  const [draft, setDraft] = useState<Retention>(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setDraft(initial);
  }, [initial]);

  const dirty =
    draft.daily !== initial.daily ||
    draft.weekly !== initial.weekly ||
    draft.monthly !== initial.monthly;

  // Mirror the script-level rule (#682) so the user sees the problem
  // before the API rejects.
  const invalid =
    draft.daily === 0 && (draft.weekly > 0 || draft.monthly > 0);

  async function save() {
    setError(null);
    setSavedFlash(false);
    setSaving(true);
    try {
      const resp = await fetch("/api/backups/retention", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft),
      });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setError(body.detail || `Save failed (${resp.status})`);
        return;
      }
      const body = await resp.json();
      const next = body.retention as Retention;
      onSaved(next);
      setSavedFlash(true);
    } catch (e) {
      setError(String(e));
    } finally {
      setSaving(false);
    }
  }

  function field(key: keyof Retention, label: string) {
    return (
      <label className="flex flex-col gap-1 text-sm">
        <span className="font-medium">{label}</span>
        <input
          type="number"
          min={0}
          value={draft[key]}
          onChange={(e) => {
            const v = parseInt(e.target.value, 10);
            setDraft((d) => ({ ...d, [key]: Number.isFinite(v) && v >= 0 ? v : 0 }));
            setSavedFlash(false);
          }}
          disabled={saving}
          className="w-24 rounded-md border border-border bg-background px-2 py-1 font-mono"
        />
      </label>
    );
  }

  return (
    <section className="rounded-lg border border-border p-4 space-y-4">
      <div>
        <h3 className="text-sm font-medium">Retention</h3>
        <p className="text-xs text-muted-foreground mt-1">
          How many backups to keep per tier. <code>0</code> disables a tier (no
          file written, no promotion). <code>1</code> keeps a single rolling
          backup that overwrites on each run. Daily must be ≥ 1 if weekly or
          monthly are set, since they hardlink from the daily file. Changes apply
          on the next backup tick (within 1 hour).
        </p>
      </div>
      <div className="flex flex-wrap gap-4">
        {field("daily", "Daily")}
        {field("weekly", "Weekly")}
        {field("monthly", "Monthly")}
      </div>
      {invalid && (
        <p className="text-xs text-destructive">
          Daily=0 requires weekly=0 and monthly=0.
        </p>
      )}
      {error && (
        <p className="text-xs text-destructive">{error}</p>
      )}
      <div className="flex items-center gap-3">
        <button
          className="px-4 py-1.5 rounded-md bg-action text-action-foreground text-sm font-medium hover:bg-action/90 disabled:opacity-50"
          onClick={save}
          disabled={!dirty || invalid || saving}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {savedFlash && (
          <span className="text-xs text-muted-foreground">
            Saved. Will apply on the next backup tick.
          </span>
        )}
      </div>
    </section>
  );
}

export default function BackupsSection() {
  const [data, setData] = useState<BackupsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function refetch() {
    const r = await fetch("/api/backups", { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }

  useEffect(() => {
    let cancelled = false;
    fetch("/api/backups")
      .then((r) => r.json())
      .then((d: BackupsResponse) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function applyRetention(next: Retention) {
    setData((prev) =>
      prev
        ? {
            ...prev,
            retention: next,
            enabled: next.daily + next.weekly + next.monthly > 0,
          }
        : prev,
    );
  }

  async function confirmDelete() {
    if (!pendingDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      const url =
        pendingDelete.kind === "db"
          ? `/api/backups/db/${encodeURIComponent(pendingDelete.tier)}/${encodeURIComponent(pendingDelete.filename)}`
          : `/api/backups/audio/${encodeURIComponent(pendingDelete.date)}`;
      const resp = await fetch(url, { method: "DELETE" });
      if (!resp.ok) {
        const body = await resp.json().catch(() => ({}));
        setDeleteError(body.detail || `Delete failed (${resp.status})`);
        return;
      }
      setPendingDelete(null);
      await refetch();
    } catch (e) {
      setDeleteError(String(e));
    } finally {
      setDeleting(false);
    }
  }

  function cancelDelete() {
    if (deleting) return;
    setPendingDelete(null);
    setDeleteError(null);
  }

  if (error) {
    return (
      <p className="text-sm text-destructive">
        Could not load backup status: {error}
      </p>
    );
  }
  if (!data) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (!data.mounted) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          The backups directory isn&apos;t reachable from the pipeline service.
          Check that <code>./backups</code> is mounted into the <code>pipeline</code>{" "}
          container.
        </p>
        <p>
          See <code>docs/guide/16-backups.md</code> for setup details.
        </p>
      </div>
    );
  }

  const totalDumps =
    data.db.daily.length + data.db.weekly.length + data.db.monthly.length;

  return (
    <div className="space-y-6">
      <div className="text-sm text-muted-foreground space-y-1">
        <p>
          Daily backups land on the host at <code>./backups/</code>. Restore via{" "}
          <code>make restore-db DATE=…</code> and{" "}
          <code>make restore-audio DATE=…</code>; see{" "}
          <code>docs/guide/16-backups.md</code>.
        </p>
        {data.last_run && (
          <p>
            Last run: <span className="font-mono">{data.last_run}</span>
          </p>
        )}
      </div>

      <RetentionEditor initial={data.retention} onSaved={applyRetention} />

      {!data.enabled ? (
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>
            All retention values are 0 — the daily backup loop is effectively
            disabled. Raise daily retention above to opt in.
          </p>
        </div>
      ) : (
        <>
          <section className="rounded-lg border border-border p-4 space-y-4">
            <h3 className="text-sm font-medium">Database dumps ({totalDumps} total)</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <DbTier
                label="Daily"
                tier="daily"
                retention={data.retention.daily}
                dumps={data.db.daily}
                onRequestDelete={setPendingDelete}
              />
              <DbTier
                label="Weekly"
                tier="weekly"
                retention={data.retention.weekly}
                dumps={data.db.weekly}
                onRequestDelete={setPendingDelete}
              />
              <DbTier
                label="Monthly"
                tier="monthly"
                retention={data.retention.monthly}
                dumps={data.db.monthly}
                onRequestDelete={setPendingDelete}
              />
            </div>
          </section>

          <section className="rounded-lg border border-border p-4 space-y-3">
            <h3 className="text-sm font-medium">
              Audio snapshots ({data.audio.length} total)
            </h3>
            {data.audio.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No audio snapshots yet.
              </p>
            ) : (
              <ul className="space-y-1 text-sm">
                {data.audio.map((s) => (
                  <li
                    key={s.date}
                    className="flex items-center justify-between gap-2 font-mono"
                  >
                    <span>{s.date}</span>
                    <span className="flex items-center gap-2">
                      <span className="text-muted-foreground">
                        {formatBytes(s.size_bytes)}
                      </span>
                      <button
                        type="button"
                        className="text-xs text-destructive hover:underline disabled:opacity-50"
                        onClick={() =>
                          setPendingDelete({
                            kind: "audio",
                            date: s.date,
                            size: s.size_bytes,
                          })
                        }
                        aria-label={`Delete audio snapshot for ${s.date}`}
                      >
                        Delete
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Sizes are tree totals; rsync hardlinks unchanged files across
              snapshots, so on-disk usage is lower than the sum.
            </p>
          </section>
        </>
      )}

      <Dialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) cancelDelete();
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete this backup?</DialogTitle>
            <DialogDescription>
              {pendingDelete?.kind === "db" ? (
                <>
                  Removing <span className="font-mono">{pendingDelete.filename}</span>{" "}
                  from <span className="font-mono">db/{pendingDelete.tier}/</span>{" "}
                  ({formatBytes(pendingDelete.size)}). Hardlinks in other tiers will
                  keep the underlying file alive on disk if they exist; only this
                  directory entry is removed. This cannot be undone.
                </>
              ) : pendingDelete?.kind === "audio" ? (
                <>
                  Removing the audio snapshot for{" "}
                  <span className="font-mono">{pendingDelete.date}</span>{" "}
                  ({formatBytes(pendingDelete.size)}). Sibling snapshots that
                  hardlink unchanged files keep their copies — only this date&apos;s
                  tree is wiped. This cannot be undone.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          {deleteError && (
            <p className="text-xs text-destructive">{deleteError}</p>
          )}
          <DialogFooter>
            <button
              type="button"
              className="px-4 py-1.5 rounded-md border border-border text-sm hover:bg-muted disabled:opacity-50"
              onClick={cancelDelete}
              disabled={deleting}
            >
              Cancel
            </button>
            <button
              type="button"
              className="px-4 py-1.5 rounded-md bg-destructive text-destructive-foreground text-sm font-medium hover:bg-destructive/90 disabled:opacity-50"
              onClick={confirmDelete}
              disabled={deleting}
            >
              {deleting ? "Deleting…" : "Delete"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
