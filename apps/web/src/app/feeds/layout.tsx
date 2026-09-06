import type { Metadata } from "next";

// #1059: this route is a client component, which cannot export metadata, so
// the segment layout names the tab instead.
export const metadata: Metadata = { title: "Feeds" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
