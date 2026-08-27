"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { clsx } from "clsx";
import { Menu, X } from "lucide-react";
import DarkModeToggle from "@/components/DarkModeToggle";

const NAV_LINKS = [
  { href: "/search", label: "Search" },
  { href: "/ask", label: "Ask" },
  { href: "/podcasts", label: "Sources" },
  { href: "/queue", label: "Queue" },
  { href: "/meta-analysis", label: "Meta-analysis" },
  { href: "/settings", label: "Settings" },
  { href: "/docs", label: "Docs" },
  { href: "/about", label: "About" },
];

function isActive(pathname: string, href: string): boolean {
  return pathname === href || (href !== "/" && pathname.startsWith(href));
}

export default function Navbar() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // #989: the panel is a navigation menu, so leaving it open across a route
  // change would cover the page the user just asked for.
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <nav className="sticky top-0 z-40 w-full border-b border-border bg-background/80 backdrop-blur-sm">
      <div className="max-w-5xl mx-auto px-4 py-2 flex items-center gap-x-6">
        <Link href="/" className="font-semibold text-lg tracking-tight">
          Podlog
        </Link>

        {/* Wide screens: the links inline, as before. */}
        <div className="hidden md:flex flex-wrap items-center gap-1 flex-1">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className={clsx(
                "px-3 py-1.5 rounded-md text-sm transition-colors",
                isActive(pathname, link.href)
                  ? "bg-accent text-accent-foreground font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              {link.label}
            </Link>
          ))}
        </div>

        {/* Narrow screens: push the toggles to the right. */}
        <div className="flex-1 md:hidden" />

        <div className="flex items-center gap-1">
          <DarkModeToggle />
          {/* #989: eight links in a flex-wrap row became four rows at 390px --
              157px of a 844px viewport, on every page, because the nav is
              sticky. Collapsing them behind this keeps it to one row. */}
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="md:hidden inline-flex items-center justify-center h-11 w-11 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {open && (
        <div
          id="mobile-nav"
          ref={panelRef}
          className="md:hidden border-t border-border bg-background"
        >
          <div className="max-w-5xl mx-auto px-4 py-2 flex flex-col">
            {NAV_LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => setOpen(false)}
                className={clsx(
                  // min-h-11 (44px) is the touch target size iOS and Android
                  // both ask for; the desktop row's py-1.5 is about 30px.
                  "flex items-center min-h-11 px-3 rounded-md text-sm transition-colors",
                  isActive(pathname, link.href)
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:text-foreground hover:bg-accent"
                )}
              >
                {link.label}
              </Link>
            ))}
          </div>
        </div>
      )}
    </nav>
  );
}
