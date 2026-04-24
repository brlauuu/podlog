"use client";

import { useEffect } from "react";
import Link from "next/link";
import type { MissingSpeakersResponse } from "@/lib/metaAnalysisTypes";

interface Props {
  open: boolean;
  onClose: () => void;
  data: MissingSpeakersResponse | null;
}

export default function MissingSpeakersModal({ open, onClose, data }: Props) {
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", h);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", h);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/70 z-50 flex items-start justify-center overflow-auto p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="missing-speakers-title"
        className="bg-background rounded-md max-w-2xl w-full p-6 mt-12 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 id="missing-speakers-title" className="text-lg font-semibold">Episodes excluded — missing speakers</h2>
          <button
            onClick={onClose}
            aria-label="Close dialog"
            className="text-muted-foreground hover:text-foreground"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>

        {!data || data.podcasts.length === 0 ? (
          <p className="text-muted-foreground text-sm">
            No excluded episodes — everything has assigned speakers.
          </p>
        ) : (
          <div className="space-y-4 max-h-[70vh] overflow-y-auto">
            {data.podcasts.map((p) => (
              <section key={p.feed_id}>
                <h3
                  className="text-sm font-semibold mb-1 truncate"
                  title={p.title}
                >
                  {p.title}
                </h3>
                <ul className="text-sm space-y-1">
                  {p.episodes.map((ep) => (
                    <li key={ep.id} className="flex items-start gap-2">
                      <Link
                        href={`/episodes/${ep.id}`}
                        className="flex-1 truncate hover:underline"
                        title={ep.title}
                      >
                        {ep.title}
                      </Link>
                      <span className="text-xs text-muted-foreground whitespace-nowrap">
                        {ep.reason}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
