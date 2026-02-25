"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import DarkModeToggle from "@/components/DarkModeToggle";

const NAV_LINKS = [
  { href: "/", label: "Search" },
  { href: "/podcasts", label: "Podcasts" },
  { href: "/queue", label: "Queue" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center gap-6">
        <Link href="/" className="font-semibold text-lg tracking-tight">
          Podlog
        </Link>

        <div className="flex items-center gap-1 flex-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                pathname === link.href
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <DarkModeToggle />
      </div>
    </nav>
  );
}
