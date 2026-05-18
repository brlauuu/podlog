"use client";

import { useState } from "react";

export default function InfoBlock() {
  const [open, setOpen] = useState(false);
  return (
    <div className="border rounded-md p-3 text-sm bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex items-center gap-2 text-left w-full font-medium"
      >
        <span aria-hidden="true">{open ? "▾" : "▸"}</span>
        What do these charts show?
      </button>
      {open && (
        <div className="mt-2 space-y-2 text-muted-foreground">
          <p>
            <strong>Per-speaker minutes / words per episode</strong> show how
            each host&apos;s airtime (or word count) evolves across a podcast&apos;s
            run. Guests are collapsed into a single dashed trace per feed; hover
            to see the names.
          </p>
          <p>
            <strong>Host vs Guest talking time</strong> plots a single signed
            delta per episode (guest avg − host avg). Above 0 means guests
            dominated on average; below 0 means hosts did. The shaded band
            shows the widest possible delta given individual speaker variation.
          </p>
          <p>
            Each chart family is shown twice — once for <strong>Confirmed</strong>{" "}
            speakers (user-validated names) and once for{" "}
            <strong>Inferred — HIGH</strong> confidence (automatic detections).
            The inferred view includes more rows but some noise (name fragments,
            false positives like &ldquo;Twitter&rdquo;, &ldquo;Linkedin&rdquo;).
          </p>
        </div>
      )}
    </div>
  );
}
