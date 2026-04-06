"use client";

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChevronRight } from "lucide-react";

interface LinkItem {
  href: string;
  title: string;
  description: string;
  highlight?: boolean;
}

interface Props {
  feedAdded: boolean;
  onFinish: () => void;
  onDontShowChange: (checked: boolean) => void;
}

export default function WizardComplete({ feedAdded, onFinish, onDontShowChange }: Props) {
  const [dontShow, setDontShow] = useState(false);

  const links: LinkItem[] = feedAdded
    ? [
        { href: "/", title: "Search", description: "Search across all your transcripts once processing completes" },
        { href: "/ask", title: "Ask AI", description: "Ask natural language questions and get answers from your transcripts" },
        { href: "/queue", title: "Queue", description: "Watch your episode move through the pipeline stages" },
        { href: "/feeds", title: "Add More Feeds", description: "Subscribe to more podcasts from the Feeds page" },
        { href: "https://github.com/brlauuu/podlog/tree/main/docs/guide", title: "User Guide", description: "Full documentation covering all features" },
      ]
    : [
        { href: "/feeds", title: "Add Your First Feed", description: "Head to the Feeds page to subscribe to a podcast", highlight: true },
        { href: "/", title: "Search", description: "Search across transcripts once you have processed episodes" },
        { href: "/ask", title: "Ask AI", description: "Ask natural language questions and get answers from your transcripts" },
        { href: "/queue", title: "Queue", description: "Monitor processing progress" },
        { href: "https://github.com/brlauuu/podlog/tree/main/docs/guide", title: "User Guide", description: "Full documentation covering all features" },
      ];

  return (
    <div>
      <div className="text-center mb-6">
        <h2 className="text-2xl font-bold mb-2">
          {feedAdded ? "You're All Set!" : "Ready When You Are"}
        </h2>
        <p className="text-sm text-muted-foreground">
          {feedAdded
            ? "Your first episode is queued for processing. Depending on episode length and your hardware, it may take 30-90 minutes."
            : "No feeds added yet — here's where to go when you're ready."}
        </p>
      </div>

      <div className="rounded-lg border bg-card p-4 mb-5">
        <p className="text-xs font-semibold text-muted-foreground mb-3">
          {feedAdded ? "What's Next" : "Getting Started"}
        </p>
        <div className="space-y-1">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={onFinish}
              className={`flex items-center gap-3 p-2.5 rounded-md transition-colors ${
                link.highlight
                  ? "border-2 border-blue-500 bg-blue-50 dark:border-blue-400 dark:bg-blue-950/30"
                  : "border border-border hover:bg-accent/40"
              }`}
            >
              <div className="min-w-0 flex-1">
                <p className={`text-sm font-semibold ${link.highlight ? "text-blue-700 dark:text-blue-300" : ""}`}>
                  {link.title}
                </p>
                <p className="text-xs text-muted-foreground">{link.description}</p>
              </div>
              <ChevronRight className={`h-4 w-4 shrink-0 ${link.highlight ? "text-blue-700 dark:text-blue-300" : "text-muted-foreground"}`} />
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
          <input
            type="checkbox"
            checked={dontShow}
            onChange={(e) => {
              setDontShow(e.target.checked);
              onDontShowChange(e.target.checked);
            }}
            className="accent-primary"
          />
          Don&apos;t show this wizard on next visit
        </label>
        <Button onClick={onFinish}>Get Started</Button>
      </div>
    </div>
  );
}
