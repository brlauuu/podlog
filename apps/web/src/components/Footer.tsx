"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity } from "lucide-react";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

interface HealthData {
  status: string;
}

export default function Footer() {
  const health = useQuery<HealthData>({
    queryKey: ["pipeline-health"],
    queryFn: async () => {
      const resp = await fetch("/api/pipeline/health", { cache: "no-store" });
      if (!resp.ok) return { status: "DEGRADED" };
      return resp.json();
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const status = health.data?.status ?? "UNKNOWN";
  const statusColor =
    status === "OK"
      ? "text-green-500"
      : status === "WARMING_UP"
        ? "text-yellow-500"
        : "text-red-500";

  return (
    <footer className="border-t border-border bg-background/80 text-sm text-muted-foreground">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Top row: branding + status */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <p className="font-semibold text-foreground text-base">Podlog</p>
            <p>Self-hosted podcast transcription and search</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Activity size={14} className={statusColor} />
            <span className={statusColor}>{status === "OK" ? "All systems online" : status === "WARMING_UP" ? "Pipeline warming up" : "Pipeline offline"}</span>
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs">
          {/* Credits */}
          <div className="space-y-2">
            <p className="font-medium text-foreground">Credits</p>
            <p>
              Built by{" "}
              <a href="https://github.com/brlauuu" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                @brlauuu
              </a>
              {" "}and{" "}
              <a href="https://www.anthropic.com" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                Claude (Anthropic)
              </a>
            </p>
            <p>
              <a href="https://github.com/brlauuu/podlog" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
              {" · "}
              <a href="https://osaasy.dev" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                O&apos;Saasy License
              </a>
            </p>
          </div>

          {/* Tech stack */}
          <div className="space-y-2">
            <p className="font-medium text-foreground">Built with</p>
            <p>Whisper &middot; pyannote &middot; Next.js &middot; PostgreSQL &middot; Celery</p>
          </div>

          {/* Privacy */}
          <div className="space-y-2">
            <p className="font-medium text-foreground">Privacy</p>
            <p>All data stays on your machine. No external telemetry.</p>
          </div>
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
          <p>&copy; 2026 Đorđe. O&apos;Saasy License.</p>
          <p>v{APP_VERSION}</p>
        </div>
      </div>
    </footer>
  );
}
