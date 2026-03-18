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
      href={`/?q=${encodeURIComponent(query)}`}
      className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition-colors"
    >
      <ArrowLeft size={14} />
      Back to search results
    </Link>
  );
}
