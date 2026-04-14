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
      className="fixed bottom-6 left-6 z-40 inline-flex items-center gap-2 rounded-full bg-action px-4 py-3 text-sm font-medium text-action-foreground shadow-lg hover:bg-action/90 transition-colors"
    >
      <ArrowLeft size={14} />
      Back to search results
    </Link>
  );
}
