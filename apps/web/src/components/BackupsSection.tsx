"use client";

import { useEffect, useState } from "react";

interface DbDump {
  date: string;
  filename: string;
  size_bytes: number;
}

interface AudioSnapshot {
  date: string;
  size_bytes: number;
}

interface BackupsResponse {
  enabled: boolean;
  mounted: boolean;
  retention: { daily: number; weekly: number; monthly: number };
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
  retention,
  dumps,
}: {
  label: string;
  retention: number;
  dumps: DbDump[];
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
              className="flex justify-between gap-3 font-mono"
            >
              <span>{d.date}</span>
              <span className="text-muted-foreground">{formatBytes(d.size_bytes)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function BackupsSection() {
  const [data, setData] = useState<BackupsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  if (!data.enabled) {
    return (
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          All retention values are 0 — the daily backup loop is effectively
          disabled. Set <code>BACKUP_RETENTION_DAILY</code>,{" "}
          <code>BACKUP_RETENTION_WEEKLY</code>, or{" "}
          <code>BACKUP_RETENTION_MONTHLY</code> to a non-zero value in{" "}
          <code>.env</code> to opt in.
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

      <section className="rounded-lg border border-border p-4 space-y-4">
        <h3 className="text-sm font-medium">Database dumps ({totalDumps} total)</h3>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <DbTier
            label="Daily"
            retention={data.retention.daily}
            dumps={data.db.daily}
          />
          <DbTier
            label="Weekly"
            retention={data.retention.weekly}
            dumps={data.db.weekly}
          />
          <DbTier
            label="Monthly"
            retention={data.retention.monthly}
            dumps={data.db.monthly}
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
                className="flex justify-between gap-3 font-mono"
              >
                <span>{s.date}</span>
                <span className="text-muted-foreground">
                  {formatBytes(s.size_bytes)}
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
    </div>
  );
}
