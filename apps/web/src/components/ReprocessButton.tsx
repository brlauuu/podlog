"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

interface ReprocessButtonProps {
  episodeId: string;
  status: string;
}

export default function ReprocessButton({ episodeId, status }: ReprocessButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  if (status !== "done" && status !== "failed") return null;

  async function handleReprocess() {
    if (!window.confirm("Re-queue this episode for full reprocessing?")) return;

    setLoading(true);
    try {
      const resp = await fetch(`/api/episodes/${episodeId}/retry`, { method: "POST" });
      if (!resp.ok) {
        const data = await resp.json().catch(() => null);
        throw new Error(data?.detail ?? `Request failed (${resp.status})`);
      }
      router.refresh();
    } catch (err: unknown) {
      alert(err instanceof Error ? err.message : "Failed to reprocess episode");
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={handleReprocess}
      disabled={loading}
      className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
    >
      <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
      {loading ? "Reprocessing..." : "Reprocess"}
    </button>
  );
}
