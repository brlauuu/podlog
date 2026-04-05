"use client";

import { HelpCircle, Wand2, BookOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useWizard } from "@/components/WizardProvider";

interface ServiceStatus {
  name: string;
  status: string;
}

interface HealthData {
  status: string;
  services?: ServiceStatus[];
}

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

export default function HelpMenu() {
  const { setOpen } = useWizard();

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
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          aria-label="Help"
          className="flex items-center justify-center h-7 w-7 rounded-full border border-border text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
        >
          <HelpCircle className="h-4 w-4" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => setOpen(true)} className="cursor-pointer gap-2">
          <Wand2 className="h-4 w-4" />
          Setup Wizard
        </DropdownMenuItem>
        <DropdownMenuItem asChild className="cursor-pointer gap-2">
          <a
            href="https://github.com/brlauuu/podlog/tree/main/docs/guide"
            target="_blank"
            rel="noopener noreferrer"
          >
            <BookOpen className="h-4 w-4" />
            User Guide
          </a>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 space-y-1.5">
          <p className="text-xs font-medium text-foreground">System status</p>
          {services.length > 0 ? (
            <div className="space-y-1">
              {services.map((svc) => (
                <div key={svc.name} className="flex items-center gap-2 text-xs text-muted-foreground">
                  <StatusDot status={svc.status} />
                  <span>{svc.name}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusDot status="DEGRADED" />
              <span>Checking...</span>
            </div>
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
