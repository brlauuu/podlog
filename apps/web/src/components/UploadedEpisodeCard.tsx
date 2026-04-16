"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { CheckCircle2, FileAudio, Loader2, Trash2, XCircle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

interface UploadedEpisodeCardProps {
  id: string;
  title: string | null;
  status: string;
  created_at: string;
}

export default function UploadedEpisodeCard({ id, title, status, created_at }: UploadedEpisodeCardProps) {
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (!confirm(`Delete "${title ?? "this upload"}"? The audio file and transcript will be removed.`)) {
      return;
    }
    setDeleting(true);
    try {
      const resp = await fetch(`/api/episodes/${id}`, { method: "DELETE" });
      if (!resp.ok && resp.status !== 204) {
        const body = await resp.json().catch(() => ({}));
        alert(body.detail ?? "Failed to delete episode");
        return;
      }
      router.refresh();
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Link href={`/episodes/${id}`}>
      <Card className="hover:bg-accent/30 transition-colors">
        <CardContent className="p-3 flex items-center gap-3">
          <FileAudio size={16} className="text-muted-foreground shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium truncate">{title ?? "Untitled"}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(created_at).toLocaleDateString()}
            </p>
          </div>
          {status === "done" ? (
            <CheckCircle2 size={14} className="text-green-600 dark:text-green-400 shrink-0" />
          ) : status === "failed" ? (
            <XCircle size={14} className="text-red-600 dark:text-red-400 shrink-0" />
          ) : (
            <Loader2 size={14} className="text-blue-600 dark:text-blue-400 animate-spin shrink-0" />
          )}
          <button
            type="button"
            aria-label="Delete upload"
            onClick={handleDelete}
            disabled={deleting}
            className="shrink-0 p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            {deleting ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
          </button>
        </CardContent>
      </Card>
    </Link>
  );
}
