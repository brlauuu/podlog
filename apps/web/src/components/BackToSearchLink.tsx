"use client";

import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Renders a "Back to search results" link when the episode page was reached
 * from a search result (indicated by the ?q= query parameter).
 */
export default function BackToSearchLink() {
  const searchParams = useSearchParams();
  const query = searchParams.get("q");

  if (!query) return null;

  return (
    <Link
      href={`/search?q=${encodeURIComponent(query)}`}
      className="fixed left-3 sm:left-4 top-20 z-40 inline-flex items-center gap-1 rounded-full border border-input bg-background/95 px-3 py-1.5 text-sm font-medium text-muted-foreground shadow-sm backdrop-blur supports-[backdrop-filter]:bg-background/80 hover:bg-accent hover:text-foreground transition-colors"
    >
      <ArrowLeft size={14} />
      Back to search results
    </Link>
  );
}
