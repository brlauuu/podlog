"use client";

import { useState, useEffect, useRef, type ReactNode } from "react";

interface HelpPopoverProps {
  title: string;
  children: ReactNode;
}

export default function HelpPopover({ title, children }: HelpPopoverProps) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setPinned(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  return (
    <div className="text-center">
      <div className="relative inline-flex items-center gap-2 min-h-10" ref={ref}>
        <h1 className="text-3xl font-bold">{title}</h1>
        <button
          type="button"
          aria-label={`${title} help`}
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => {
            if (!pinned) setOpen(false);
          }}
          onClick={() => {
            const nextPinned = !pinned;
            setPinned(nextPinned);
            setOpen(nextPinned);
          }}
          className="h-5 w-5 rounded-full border border-input text-xs font-semibold text-muted-foreground hover:text-foreground hover:bg-accent/30 transition-colors"
        >
          ?
        </button>
        {open && (
          <div
            role="dialog"
            aria-label={`${title} help details`}
            onMouseEnter={() => setOpen(true)}
            onMouseLeave={() => {
              if (!pinned) setOpen(false);
            }}
            className="absolute left-1/2 top-full z-40 mt-2 w-[min(28rem,90vw)] -translate-x-1/2 rounded-md border border-border bg-background p-3 text-left text-sm text-foreground shadow-lg"
          >
            {children}
          </div>
        )}
      </div>
    </div>
  );
}
