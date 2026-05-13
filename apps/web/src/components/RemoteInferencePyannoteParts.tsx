"use client";

/**
 * pyannote-cloud intro + API-key entry for the Remote Inference settings
 * section (split out of RemoteInferenceSectionParts in #663). Re-exported
 * from RemoteInferenceSectionParts for back-compat.
 */
import { useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { inputClass } from "./RemoteInferencePipelineSteps";

export function PyannoteCloudIntro() {
  return (
    <Collapsible>
      <div className="rounded-lg border border-border bg-muted/50 p-4">
        <CollapsibleTrigger className="flex w-full items-center justify-between text-left">
          <h3 className="text-sm font-medium text-muted-foreground">
            What is pyannote cloud (Precision-2)?
          </h3>
          <span className="text-xs text-muted-foreground">Show</span>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 space-y-2 text-sm text-muted-foreground">
            <p>
              Precision-2 is pyannote.ai&apos;s paid hosted diarization model.
              It runs on their infrastructure (no local CPU/RAM cost) and is
              reported to be ~28% more accurate than the free local{" "}
              <code>community-1</code> model on typical podcast audio.
            </p>
            <p>Enable it when:</p>
            <ul className="list-disc ml-5 space-y-1">
              <li>Your local machine struggles with diarization memory.</li>
              <li>You want higher speaker-labeling accuracy.</li>
              <li>You&apos;re fine paying per-second for audio processed.</li>
            </ul>
            <p>
              To enable: create an account and API key at{" "}
              <a
                href="https://dashboard.pyannote.ai"
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                dashboard.pyannote.ai
              </a>
              , paste the key below, and flip the Diarization step to
              &quot;Remote&quot; under Pipeline Steps. Billing is per second of
              audio processed, with a 20-second per-request minimum. Check your
              dashboard for the exact rate on your tier.
            </p>
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

export function PyannoteApiKeyField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium mb-1">
        pyannote cloud API key
      </label>
      <p className="text-xs text-muted-foreground mb-1.5">
        Required only for the Precision-2 diarization option. Stored securely
        and masked on read. Generate at{" "}
        <a
          href="https://dashboard.pyannote.ai"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          dashboard.pyannote.ai
        </a>
        .
      </p>
      <div className="relative">
        <input
          id="pyannote-api-key"
          type={showApiKey ? "text" : "password"}
          className={inputClass}
          placeholder="Your pyannote.ai API key"
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
