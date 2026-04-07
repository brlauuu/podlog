"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import DarkModeToggle from "@/components/DarkModeToggle";
import HelpMenu from "@/components/HelpMenu";

const NAV_LINKS = [
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask" },
  { href: "/podcasts", label: "Sources" },
  { href: "/queue", label: "Queue" },
  { href: "/settings", label: "Settings" },
  { href: "/about", label: "About" },
];

export default function Navbar() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-4 py-2 flex flex-wrap items-center gap-x-6 gap-y-1">
        <Link href="/" className="font-semibold text-lg tracking-tight">
          Podlog
        </Link>

        <div className="flex flex-wrap items-center gap-1 flex-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                (pathname === link.href || (link.href !== "/" && pathname.startsWith(link.href)))
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <HelpMenu />
          <DarkModeToggle />
        </div>
      </div>
    </nav>
  );
}
