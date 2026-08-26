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

/**
 * Per-second billing rate for pyannote cloud (#969).
 *
 * The setting existed everywhere except here: it is in settings-schema.ts,
 * in the Inference tab's dirty-field set, validated server-side as a finite
 * non-negative number, and read by tasks/diarize.py -- but nothing rendered
 * an input, so the only way to set it was `.env` or a direct DB write. The
 * episode cost chip told users to set it "in Settings", pointing at a control
 * that did not exist.
 *
 * pyannote.ai does not publish the rate (it varies by tier), so Podlog cannot
 * derive it; 0 means "no estimate" rather than "free".
 */
export function PyannoteCostRateField({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (value: number) => void;
}) {
  // Kept as a string so the field can be cleared mid-edit without the value
  // snapping back to 0 on every keystroke.
  const [draft, setDraft] = useState<string>(
    value == null ? "" : String(value)
  );

  // Re-sync when the saved value changes underneath us (e.g. a save
  // round-trip returning the persisted number). Adjusted during render
  // rather than in an effect -- React's documented pattern for deriving
  // state from a changed prop, and it avoids the extra render an effect
  // would cause.
  const [lastValue, setLastValue] = useState<number | null>(value);
  if (value !== lastValue) {
    setLastValue(value);
    setDraft(value == null ? "" : String(value));
  }

  function commit(next: string) {
    setDraft(next);
    const parsed = Number(next);
    // Empty or unparseable means "no estimate" -- send 0 rather than NaN,
    // which the server rejects outright.
    if (next.trim() === "" || !Number.isFinite(parsed) || parsed < 0) {
      onChange(0);
      return;
    }
    onChange(parsed);
  }

  const parsed = Number(draft);
  const invalid =
    draft.trim() !== "" && (!Number.isFinite(parsed) || parsed < 0);

  return (
    <div className="mb-4">
      <label
        htmlFor="pyannote-cost-rate"
        className="block text-sm font-medium mb-1"
      >
        pyannote cloud rate (USD per second)
      </label>
      <p className="text-xs text-muted-foreground mb-1.5">
        Optional. Used only to estimate the cost shown on each episode. Check
        your tier&apos;s rate at{" "}
        <a
          href="https://dashboard.pyannote.ai"
          target="_blank"
          rel="noreferrer"
          className="underline"
        >
          dashboard.pyannote.ai
        </a>
        {" "}— Podlog cannot look it up. Leave at 0 to skip estimates; billing
        still happens, the chip just shows{" "}
        <span className="font-mono">$—</span>.
      </p>
      <input
        id="pyannote-cost-rate"
        type="number"
        inputMode="decimal"
        min={0}
        step="0.0001"
        className={inputClass}
        placeholder="0.0"
        value={draft}
        aria-invalid={invalid || undefined}
        onChange={(e) => commit(e.target.value)}
      />
      {invalid && (
        <p className="mt-1 text-xs text-destructive">
          Enter a non-negative number.
        </p>
      )}
    </div>
  );
}

type TestState =
  | { status: "idle" }
  | { status: "testing" }
  | { status: "ok" }
  | { status: "error"; message: string };

export function PyannoteApiKeyField({
  value,
  onChange,
}: {
  value: string | null;
  onChange: (value: string) => void;
}) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [test, setTest] = useState<TestState>({ status: "idle" });

  // #933: the check itself already existed (verify_api_key) but nothing called
  // it, so docs told users to curl GET /v1/test by hand. An unverified key
  // otherwise fails silently at save and only surfaces as a 401 once
  // diarization runs -- after the episode has been downloaded and transcribed.
  //
  // The typed value is sent so a key can be checked before saving. When the
  // field is untouched it holds the masked form (abc***xyz); the server treats
  // that as "unchanged" and tests the stored key instead.
  async function handleTest() {
    setTest({ status: "testing" });
    try {
      const resp = await fetch("/api/pyannote/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ api_key: value ?? "" }),
      });
      if (resp.ok) {
        setTest({ status: "ok" });
        return;
      }
      const err = await resp.json().catch(() => ({}));
      setTest({ status: "error", message: err.error || "Test failed" });
    } catch {
      setTest({ status: "error", message: "Network error" });
    }
  }

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
      <div className="mt-2 flex items-center gap-3">
        <button
          type="button"
          onClick={handleTest}
          disabled={test.status === "testing"}
          className="px-3 py-1.5 rounded-md border border-border text-xs font-medium hover:bg-muted disabled:opacity-50"
        >
          {test.status === "testing" ? "Testing..." : "Test key"}
        </button>
        {test.status === "ok" && (
          <span className="text-xs text-green-600 dark:text-green-500">
            Key is valid.
          </span>
        )}
        {test.status === "error" && (
          <span className="text-xs text-destructive">{test.message}</span>
        )}
      </div>
    </div>
  );
}
