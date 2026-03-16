"use client";

import { useQuery } from "@tanstack/react-query";
import { Github } from "lucide-react";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.1.0";

interface ServiceStatus {
  name: string;
  status: string;
}

interface HealthData {
  status: string;
  services?: ServiceStatus[];
}

const TECH_STACK = [
  { name: "WhisperX", url: "https://github.com/m-bain/whisperX" },
  { name: "faster-whisper", url: "https://github.com/SYSTRAN/faster-whisper" },
  { name: "pyannote", url: "https://github.com/pyannote/pyannote-audio" },
  { name: "Next.js", url: "https://nextjs.org" },
  { name: "PostgreSQL", url: "https://www.postgresql.org" },
  { name: "Celery", url: "https://docs.celeryq.dev" },
  { name: "Redis", url: "https://redis.io" },
  { name: "Tailwind CSS", url: "https://tailwindcss.com" },
  { name: "shadcn/ui", url: "https://ui.shadcn.com" },
];

function StatusDot({ status }: { status: string }) {
  const color =
    status === "OK"
      ? "bg-green-500"
      : status === "WARMING_UP"
        ? "bg-amber-500"
        : "bg-red-500";

  return (
    <span className={`inline-block w-2 h-2 rounded-full ${color} shrink-0`} />
  );
}

export default function Footer() {
  const health = useQuery<HealthData>({
    queryKey: ["pipeline-health"],
    queryFn: async () => {
      const resp = await fetch("/api/pipeline/health", { cache: "no-store" });
      if (!resp.ok) return { status: "DEGRADED", services: [] };
      return resp.json();
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const services = health.data?.services ?? [];

  return (
    <footer className="border-t border-border bg-background text-sm text-muted-foreground mt-auto">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">
        {/* Top row: branding + system status */}
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
          <div className="space-y-1">
            <p className="font-semibold text-foreground text-base">Podlog</p>
            <p>Self-hosted podcast transcription and search</p>
          </div>
          <div className="space-y-1.5 text-xs">
            <p className="font-medium text-foreground">System status</p>
            {services.length > 0 ? (
              <div className="space-y-1">
                {services.map((svc) => (
                  <div key={svc.name} className="flex items-center gap-2">
                    <StatusDot status={svc.status} />
                    <span>{svc.name}</span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <StatusDot status="DEGRADED" />
                <span>Checking...</span>
              </div>
            )}
          </div>
        </div>

        {/* Info grid */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 text-xs">
          {/* Credits */}
          <div className="space-y-2">
            <p className="font-medium text-foreground">Credits</p>
            <p>
              Built by{" "}
              <a href="https://brlauuu.github.io" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                @brlauuu
              </a>
              {" "}and{" "}
              <a href="https://www.anthropic.com" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                Claude (Anthropic)
              </a>
            </p>
            <div className="flex items-center gap-1.5">
              <Github size={13} />
              <a href="https://github.com/brlauuu/podlog" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                brlauuu/podlog
              </a>
              {" · "}
              <a href="https://osaasy.dev" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                O&apos;Saasy License
              </a>
            </div>
          </div>

          {/* Tech stack with links */}
          <div className="space-y-2">
            <p className="font-medium text-foreground">Built with</p>
            <p className="leading-relaxed">
              {TECH_STACK.map((tech, i) => (
                <span key={tech.name}>
                  <a href={tech.url} className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">
                    {tech.name}
                  </a>
                  {i < TECH_STACK.length - 1 ? " · " : ""}
                </span>
              ))}
            </p>
          </div>

          {/* Privacy */}
          <div className="space-y-2">
            <p className="font-medium text-foreground">Privacy</p>
            <p>All data stays on your machine. No external telemetry.</p>
          </div>
        </div>

        {/* Bottom row */}
        <div className="flex items-center justify-between pt-2 border-t border-border text-xs">
          <p>&copy; 2026 <a href="https://brlauuu.github.io" className="underline hover:text-foreground" target="_blank" rel="noopener noreferrer">brlauuu</a>. O&apos;Saasy License.</p>
          <p>v{APP_VERSION}</p>
        </div>
      </div>
    </footer>
  );
}
