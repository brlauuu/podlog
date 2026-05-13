"use client";

/**
 * Fireworks-provider intro + API-key entry for the Remote Inference
 * settings section (split out of RemoteInferenceSectionParts in #663).
 * Re-exported from RemoteInferenceSectionParts for back-compat.
 */
import { useState } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { inputClass } from "./RemoteInferencePipelineSteps";

export function RemoteProviderIntro() {
  return (
    <div className="space-y-4">
      <div className="mb-4">
        <label className="block text-sm font-medium mb-1">
          Remote inference provider
        </label>
        <Select defaultValue="fireworks" disabled>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="fireworks">Fireworks AI</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Issue #608: explicit data-egress notice so users know what leaves
          their machine when they flip a step to remote. */}
      <div
        role="note"
        className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 text-sm text-foreground"
      >
        <p className="font-medium text-amber-700 dark:text-amber-400 mb-1">
          Privacy: what leaves your machine
        </p>
        <p className="text-muted-foreground">
          When a pipeline step is set to a remote provider, the data for that
          step (audio for transcription &amp; diarization; queries and retrieved
          transcript chunks for RAG / Ask; embedding inputs for embeddings) is
          sent to that provider&apos;s servers for processing. Steps left on{" "}
          <b>local</b> stay on this machine.
        </p>
      </div>

      <Collapsible>
        <div className="rounded-lg border border-border bg-muted/50 p-4">
          <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
            <h3 className="text-sm font-medium text-muted-foreground">
              What are remote inference providers?
            </h3>
            <span className="text-xs text-muted-foreground">Show</span>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 space-y-2 text-sm text-muted-foreground">
              <p>
                Remote inference providers process your audio and text on
                external servers instead of your local machine. This is useful
                when:
              </p>
              <ul className="list-disc ml-5 space-y-1">
                <li>
                  Your hardware is slow (e.g. CPU-only machines where
                  transcription takes a long time)
                </li>
                <li>You want faster processing at a per-minute cost</li>
                <li>You want to free up local resources for other tasks</li>
              </ul>
              <p>
                Currently,{" "}
                <a
                  href="https://fireworks.ai"
                  target="_blank"
                  rel="noreferrer"
                  className="underline"
                >
                  Fireworks AI
                </a>{" "}
                is the supported provider. You need a Fireworks API key to
                enable remote processing.
              </p>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>
    </div>
  );
}

export function FireworksApiKeyField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1">Fireworks API Key</label>
      <p className="text-xs text-muted-foreground mb-1.5">
        Required for remote inference. Stored securely and masked on read.
        Generate at{" "}
        <a
          href="https://fireworks.ai/account/api-keys"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          fireworks.ai/account/api-keys
        </a>
        .
      </p>
      <div className="relative">
        <input
          id="fireworks-api-key"
          type={showApiKey ? "text" : "password"}
          className={inputClass}
          placeholder="fw_..."
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground px-2 py-1"
          onClick={() => setShowApiKey(!showApiKey)}
        >
          {showApiKey ? "Hide" : "Show"}
        </button>
      </div>
    </div>
  );
}
