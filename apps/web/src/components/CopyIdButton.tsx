"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";

interface CopyIdButtonProps {
  value: string;
  label?: string;
}

export default function CopyIdButton({ value, label = "Copy ID" }: CopyIdButtonProps) {
  const [copied, setCopied] = useState(false);

  async function onClick() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API unavailable (insecure context, denied permission). No-op.
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={copied ? "Copied" : label}
      aria-label={copied ? "Copied" : label}
      className="inline-flex items-center justify-center h-6 w-6 rounded text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
    >
      {copied ? (
        <Check size={14} className="text-green-600 dark:text-green-400" />
      ) : (
        <Copy size={14} />
      )}
    </button>
  );
}
