"use client";

import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Check } from "lucide-react";

interface ServiceStatus {
  name: string;
  status: string;
}

interface HealthResponse {
  status: string;
  services: ServiceStatus[];
}

const STATUS_LABELS: Record<string, Record<string, string>> = {
  Database: { OK: "Connected", DEGRADED: "Degraded" },
  "Pipeline API": { OK: "Healthy", DEGRADED: "Degraded" },
  Worker: { OK: "Ready", WARMING_UP: "Downloading models...", DEGRADED: "Degraded" },
};

function badgeClass(status: string): string {
  if (status === "OK") return "bg-green-900/40 text-green-400";
  if (status === "WARMING_UP") return "bg-yellow-900/40 text-yellow-400";
  return "bg-muted text-muted-foreground";
}

function statusIcon(status: string) {
  if (status === "OK") {
    return <Check className="h-3.5 w-3.5 text-green-400" />;
  }
  if (status === "WARMING_UP") {
    return <span className="h-2.5 w-2.5 rounded-full bg-yellow-400 animate-pulse" />;
  }
  return <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" />;
}

interface Props {
  onNext: () => void;
  onSkip: () => void;
}

const FALLBACK_SERVICES: ServiceStatus[] = [
  { name: "Database", status: "UNKNOWN" },
  { name: "Pipeline API", status: "UNKNOWN" },
  { name: "Worker", status: "UNKNOWN" },
];

export default function WizardHealthCheck({ onNext, onSkip }: Props) {
  const { data, isError } = useQuery<HealthResponse>({
    queryKey: ["wizard-health"],
    queryFn: async () => {
      const resp = await fetch("/api/pipeline/health");
      if (!resp.ok) throw new Error("Health check failed");
      return resp.json();
    },
    refetchInterval: 3000,
  });

  const services = isError ? FALLBACK_SERVICES : (data?.services ?? []);
  const allReady = data?.status === "OK";

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">Welcome to Podlog</h2>
        <p className="text-sm text-muted-foreground">
          Self-hosted podcast transcription &amp; search.
          <br />
          Everything runs locally — your data never leaves this machine.
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-5">
        <p className="text-xs font-semibold text-muted-foreground mb-3">System Status</p>
        <div className="space-y-2">
          {services.map((svc) => (
            <div key={svc.name} className="flex items-center gap-2">
              {statusIcon(svc.status)}
              <span className="text-sm">{svc.name}</span>
              <span className={`ml-auto text-xs px-2 py-0.5 rounded-full ${badgeClass(svc.status)}`}>
                {STATUS_LABELS[svc.name]?.[svc.status] ?? svc.status}
              </span>
            </div>
          ))}
        </div>

        {services.some((s) => s.status === "WARMING_UP") && (
          <div className="mt-3">
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div className="h-full bg-yellow-400 rounded-full animate-pulse" style={{ width: "45%" }} />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Whisper + pyannote (~3 GB) — first run only
            </p>
          </div>
        )}
      </div>

      {allReady && (
        <div className="rounded-lg border border-green-800 bg-green-950/30 p-3 mb-5 text-center">
          <span className="text-sm text-green-400">All systems ready — let&apos;s add your first podcast!</span>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button variant="outline" onClick={onSkip}>
          Skip wizard
        </Button>
        <Button onClick={onNext}>Next →</Button>
      </div>
    </div>
  );
}
